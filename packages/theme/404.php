<?php
/**
 * 404 template.
 *
 * Friendly not-found page that auto-redirects to the front page after 5 seconds.
 * Uses a meta refresh as the no-JS fallback and a small inline script for the
 * live countdown.
 *
 * @package HooksGraph
 */

$home_url    = home_url( '/' );
$redirect_in = 5;
?><!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta http-equiv="refresh" content="<?php echo esc_attr( $redirect_in ); ?>;url=<?php echo esc_url( $home_url ); ?>">
	<meta name="robots" content="noindex,nofollow">
	<title><?php echo esc_html( sprintf( /* translators: %s: site title. */ __( '404 — %s', 'hooksgraph' ), get_bloginfo( 'name', 'display' ) ) ); ?></title>
	<?php wp_head(); ?>
	<style>
		body.hooksgraph-404 {
			min-height: 100vh;
			margin: 0;
			display: flex;
			align-items: center;
			justify-content: center;
			background: #f3f4f6;
			color: #111827;
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
			text-align: center;
			padding: 2rem;
		}
		.hooksgraph-404-card {
			max-width: 32rem;
		}
		.hooksgraph-404-code {
			font-size: clamp(4rem, 12vw, 7rem);
			font-weight: 700;
			line-height: 1;
			margin: 0 0 0.5rem;
			color: #2563eb;
			letter-spacing: -0.02em;
		}
		.hooksgraph-404-card h1 {
			font-size: 1.25rem;
			font-weight: 600;
			margin: 0 0 0.75rem;
			color: #111827;
		}
		.hooksgraph-404-card p {
			line-height: 1.6;
			margin: 0;
			color: #6b7280;
			font-size: 0.95rem;
		}
		.hooksgraph-404-countdown {
			font-variant-numeric: tabular-nums;
			color: #2563eb;
			font-weight: 600;
		}
	</style>
</head>
<body <?php body_class( 'hooksgraph-404' ); ?>>
	<main class="hooksgraph-404-card">
		<div class="hooksgraph-404-code">404</div>
		<h1><?php esc_html_e( 'Page not found', 'hooksgraph' ); ?></h1>
		<p>
			<?php
			printf(
				/* translators: %s: countdown span. */
				esc_html__( 'Redirecting you home in %s seconds…', 'hooksgraph' ),
				'<span class="hooksgraph-404-countdown" data-countdown="' . esc_attr( $redirect_in ) . '">' . esc_html( $redirect_in ) . '</span>'
			);
			?>
		</p>
	</main>
	<script>
		(function () {
			var el = document.querySelector('.hooksgraph-404-countdown');
			if (!el) return;
			var remaining = parseInt(el.dataset.countdown, 10) || 5;
			var home = <?php echo wp_json_encode( $home_url ); ?>;
			var tick = setInterval(function () {
				remaining -= 1;
				if (remaining <= 0) {
					clearInterval(tick);
					window.location.replace(home);
					return;
				}
				el.textContent = String(remaining);
			}, 1000);
		})();
	</script>
	<?php wp_footer(); ?>
</body>
</html>
