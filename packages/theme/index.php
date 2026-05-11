<?php
/**
 * Fallback template.
 *
 * The Hooks Graph theme only renders meaningfully on the front page. Any
 * other route (single, archive, 404, etc.) lands here with a notice.
 *
 * @package HooksGraph
 */
?>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title><?php bloginfo( 'name' ); ?></title>
	<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
	<main class="hooksgraph-fallback">
		<h1><?php bloginfo( 'name' ); ?></h1>
		<p>
			<?php
			printf(
				/* translators: %s: link to the site front page. */
				esc_html__( 'This theme renders the interactive Hooks Graph on the front page. Visit %s to view it.', 'hooksgraph' ),
				'<a href="' . esc_url( home_url( '/' ) ) . '">' . esc_html( home_url( '/' ) ) . '</a>'
			);
			?>
		</p>
	</main>
	<?php wp_footer(); ?>
</body>
</html>
