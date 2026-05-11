<?php
/**
 * Hooks Graph theme functions.
 *
 * Enqueues the built viewer bundle (JS + CSS) emitted by `pnpm build:theme`
 * and injects the data URL globals the viewer reads at startup.
 *
 * @package HooksGraph
 */

define( 'HOOKSGRAPH_ASSET_HANDLE', 'hooksgraph-viewer' );

// Let WP manage the <title> tag from Site Title / tagline / page context.
function hooksgraph_theme_supports() {
	add_theme_support( 'title-tag' );
}
add_action( 'after_setup_theme', 'hooksgraph_theme_supports' );

/**
 * Read the build-time manifest written by scripts/build-theme.js.
 *
 * Returns array{js:string,css:string} or null when missing/invalid.
 */
function hooksgraph_load_manifest() {
	$path = get_template_directory() . '/assets/manifest.json';
	if ( ! file_exists( $path ) ) {
		return null;
	}
	$raw = file_get_contents( $path );
	if ( ! is_string( $raw ) ) {
		return null;
	}
	$decoded = json_decode( $raw, true );
	if ( ! is_array( $decoded ) || empty( $decoded['js'] ) || empty( $decoded['css'] ) ) {
		return null;
	}
	return array(
		'js'  => (string) $decoded['js'],
		'css' => (string) $decoded['css'],
	);
}

function hooksgraph_enqueue_viewer() {
	$manifest = hooksgraph_load_manifest();
	if ( null === $manifest ) {
		return;
	}

	$base_uri   = get_template_directory_uri();
	$version    = wp_get_theme()->get( 'Version' );
	// Manifest values are bare filenames relative to the theme's assets/ dir
	// (e.g. "index-XXX.js"). scripts/build-theme.js strips the dist-relative
	// "assets/" prefix before writing manifest.json.
	$assets_url = $base_uri . '/assets';

	wp_enqueue_style(
		HOOKSGRAPH_ASSET_HANDLE,
		$assets_url . '/' . ltrim( $manifest['css'], '/' ),
		array(),
		$version
	);

	wp_enqueue_script(
		HOOKSGRAPH_ASSET_HANDLE,
		$assets_url . '/' . ltrim( $manifest['js'], '/' ),
		array(),
		$version,
		array(
			'in_footer' => true,
			'strategy'  => 'defer',
		)
	);

	$demo_path  = get_template_directory() . '/demo.json';
	$demo_value = file_exists( $demo_path ) ? $base_uri . '/demo.json' : null;

	$bootstrap  = 'window.HOOKSGRAPH_JSON_URL = ' . wp_json_encode( $base_uri . '/hooks.json' ) . ';';
	$bootstrap .= 'window.HOOKSGRAPH_DEMO_URL = ' . wp_json_encode( $demo_value ) . ';';

	wp_add_inline_script( HOOKSGRAPH_ASSET_HANDLE, $bootstrap, 'before' );
}
add_action( 'wp_enqueue_scripts', 'hooksgraph_enqueue_viewer' );

// Emit favicon + search engine / social meta mirroring the viewer's index.html.
// Favicon block is skipped when the site has a Customizer Site Icon configured
// (WP renders its own <link rel="icon"> tags through wp_site_icon()).
function hooksgraph_head_meta() {
	$base        = get_template_directory_uri();
	// Title: Site Title (Settings → General). Description: tagline.
	$title       = get_bloginfo( 'name', 'display' );
	$description = get_bloginfo( 'description', 'display' );
	$image_alt   = sprintf(
		/* translators: %s: site title. */
		__( 'Open Graph preview for %s', 'hooksgraph' ),
		$title
	);
	$favicon     = esc_url( $base . '/favicon.svg' );
	$og_image    = esc_url( $base . '/og-image.png' );

	$lines = array(
		'<meta name="description" content="' . esc_attr( $description ) . '">',
		'<meta name="theme-color" content="#0b0b0c">',
		'<meta name="robots" content="index,follow">',
		'<meta property="og:title" content="' . esc_attr( $title ) . '">',
		'<meta property="og:description" content="' . esc_attr( $description ) . '">',
		'<meta property="og:type" content="website">',
		'<meta property="og:image" content="' . $og_image . '">',
		'<meta property="og:image:type" content="image/png">',
		'<meta property="og:image:alt" content="' . esc_attr( $image_alt ) . '">',
		'<meta property="og:image:width" content="2000">',
		'<meta property="og:image:height" content="1188">',
		'<meta name="twitter:card" content="summary_large_image">',
		'<meta name="twitter:title" content="' . esc_attr( $title ) . '">',
		'<meta name="twitter:description" content="' . esc_attr( $description ) . '">',
		'<meta name="twitter:image" content="' . $og_image . '">',
		'<meta name="twitter:image:alt" content="' . esc_attr( $image_alt ) . '">',
	);

	if ( ! ( function_exists( 'has_site_icon' ) && has_site_icon() ) ) {
		array_unshift(
			$lines,
			'<link rel="icon" type="image/svg+xml" href="' . $favicon . '">',
			'<link rel="apple-touch-icon" href="' . $favicon . '">'
		);
	}

	echo implode( "\n", $lines ) . "\n";
}
add_action( 'wp_head', 'hooksgraph_head_meta' );

// Viewer bundle is an ES module. Mark the main <script src> tag as type="module".
function hooksgraph_script_attributes( $attributes ) {
	if ( isset( $attributes['id'] ) && HOOKSGRAPH_ASSET_HANDLE . '-js' === $attributes['id'] ) {
		$attributes['type'] = 'module';
	}
	return $attributes;
}
add_filter( 'wp_script_attributes', 'hooksgraph_script_attributes' );

// Match the inline 'before' bootstrap so it sits in module scope alongside the bundle.
function hooksgraph_inline_script_attributes( $attributes ) {
	if ( isset( $attributes['id'] ) && HOOKSGRAPH_ASSET_HANDLE . '-js-before' === $attributes['id'] ) {
		$attributes['type'] = 'module';
	}
	return $attributes;
}
add_filter( 'wp_inline_script_attributes', 'hooksgraph_inline_script_attributes' );
