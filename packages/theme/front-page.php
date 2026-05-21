<?php
/**
 * Front page: Hooks Graph viewer.
 *
 * Hardcoded classic-theme template. The viewer bundle is enqueued by
 * functions.php and mounts on #root. Data URL is injected as
 * window.HOOKSGRAPH_JSON_URL before the module runs.
 *
 * @package HooksGraph
 */
?><!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<?php wp_head(); ?>
</head>
<body <?php body_class( 'hooksgraph-viewer' ); ?>>
	<?php wp_body_open(); ?>
	<div id="root"></div>
	<?php wp_footer(); ?>
</body>
</html>
