#!/usr/bin/env bash
#
# Installs WordPress + the WP test library into an isolated directory so the
# HooksGraph plugin PHPUnit suite can run. Adapted from the
# woocommerce-gift-cards installer (bin/install.sh) but trimmed: no WooCommerce
# fetch, no plugin under test fetch — the plugin lives in this repo and is
# loaded directly by tests/bootstrap.php.

if [ $# -lt 3 ]; then
	echo "Usage: $0 <db-name> <db-user> <db-pass> [db-host] [wp-version]"
	exit 1
fi

DB_NAME=$1
DB_USER=$2
DB_PASS=$3
DB_HOST=${4-localhost}
WP_VERSION=${5-latest}

TESTS_LIB_DIR="${WP_TESTS_DIR-$HOME/.hooks-graph-unit-tests/wordpress-tests-lib}"
TESTS_WP_DIR="${WP_CORE_DIR-$HOME/.hooks-graph-unit-tests/wordpress}"

echo "WP_TESTS_DIR=$TESTS_LIB_DIR"
echo "WP_CORE_DIR=$TESTS_WP_DIR"

download() {
	if [ "$(which curl)" ]; then
		curl -s "$1" > "$2"
	elif [ "$(which wget)" ]; then
		wget -nv -O "$2" "$1"
	fi
}

if [[ $WP_VERSION =~ ^[0-9]+(\.[0-9]+)*$ ]]; then
	WP_TESTS_TAG="tags/$WP_VERSION"
else
	download http://api.wordpress.org/core/version-check/1.7/ /tmp/wp-latest.json
	LATEST_VERSION=$(grep -o '"version":"[^"]*' /tmp/wp-latest.json | sed 's/"version":"//' | head -n 1)
	if [[ -z "$LATEST_VERSION" ]]; then
		echo "Latest WordPress version could not be found"
		exit 1
	fi
	WP_TESTS_TAG="tags/$LATEST_VERSION"
	rm /tmp/wp-latest.json
fi

set -ex

install_wp() {
	if [ -d "$TESTS_WP_DIR" ] && [ -f "$TESTS_WP_DIR/wp-load.php" ]; then
		echo "WordPress already installed at $TESTS_WP_DIR — skipping."
		return
	fi

	mkdir -p "$TESTS_WP_DIR"

	if [ "$WP_VERSION" == 'latest' ] || [ "$WP_VERSION" == 'nightly' ]; then
		local TAR_FILE='https://wordpress.org/latest.tar.gz'
	else
		local TAR_FILE="https://wordpress.org/wordpress-$WP_VERSION.tar.gz"
	fi

	download "$TAR_FILE" /tmp/wordpress.tar.gz
	tar --strip-components=1 -zxmf /tmp/wordpress.tar.gz -C "$TESTS_WP_DIR"

	if [ ! -d "$TESTS_WP_DIR/wp-content/uploads" ]; then
		mkdir -p "$TESTS_WP_DIR/wp-content/uploads"
	fi
}

install_test_suite() {
	if [[ $(uname -s) == 'Darwin' ]]; then
		local ioption='-i .bak'
	else
		local ioption='-i'
	fi

	if [ -d "$TESTS_LIB_DIR/includes" ]; then
		echo "WP test suite already installed at $TESTS_LIB_DIR — skipping checkout."
	else
		mkdir -p "$TESTS_LIB_DIR"
		svn co --quiet --ignore-externals "https://develop.svn.wordpress.org/${WP_TESTS_TAG}/tests/phpunit/includes/" "$TESTS_LIB_DIR/includes"
		svn co --quiet --ignore-externals "https://develop.svn.wordpress.org/${WP_TESTS_TAG}/tests/phpunit/data/" "$TESTS_LIB_DIR/data"
	fi

	if [ ! -f "$TESTS_LIB_DIR/wp-tests-config.php" ]; then
		download "https://develop.svn.wordpress.org/${WP_TESTS_TAG}/wp-tests-config-sample.php" "$TESTS_LIB_DIR/wp-tests-config.php"
		sed $ioption "s:dirname( __FILE__ ) . '/src/':'$TESTS_WP_DIR/':" "$TESTS_LIB_DIR/wp-tests-config.php"
		sed $ioption "s/youremptytestdbnamehere/$DB_NAME/" "$TESTS_LIB_DIR/wp-tests-config.php"
		sed $ioption "s/yourusernamehere/$DB_USER/" "$TESTS_LIB_DIR/wp-tests-config.php"
		sed $ioption "s/yourpasswordhere/$DB_PASS/" "$TESTS_LIB_DIR/wp-tests-config.php"
		sed $ioption "s|localhost|${DB_HOST}|" "$TESTS_LIB_DIR/wp-tests-config.php"
	fi
}

install_db() {
	if [[ "$DB_HOST" == :* ]]; then
		local DB_HOSTNAME=""
		local DB_SOCK_OR_PORT
		DB_SOCK_OR_PORT=$(echo "$DB_HOST" | cut -d':' -f2-)
	elif [[ "$DB_HOST" == *:* ]]; then
		local DB_HOSTNAME
		local DB_SOCK_OR_PORT
		DB_HOSTNAME=$(echo "$DB_HOST" | rev | cut -d':' -f2- | rev)
		DB_SOCK_OR_PORT=$(echo "$DB_HOST" | rev | cut -d':' -f1 | rev)
	else
		local DB_HOSTNAME=$DB_HOST
		local DB_SOCK_OR_PORT=""
	fi

	local EXTRA=""
	if [ -n "$DB_HOSTNAME" ]; then
		if [ "$(echo "$DB_SOCK_OR_PORT" | grep -e '^[0-9]\{1,\}$')" ]; then
			EXTRA=" --host=$DB_HOSTNAME --port=$DB_SOCK_OR_PORT --protocol=tcp"
		elif [ -n "$DB_SOCK_OR_PORT" ]; then
			EXTRA=" --socket=$DB_SOCK_OR_PORT"
		else
			EXTRA=" --host=$DB_HOSTNAME --protocol=tcp"
		fi
	fi

	echo "drop database if exists ${DB_NAME}" | mysql --user="${DB_USER}" --password="${DB_PASS}"${EXTRA}
	mysqladmin create "$DB_NAME" --user="$DB_USER" --password="$DB_PASS"$EXTRA || true
}

install_wp
install_test_suite
install_db
