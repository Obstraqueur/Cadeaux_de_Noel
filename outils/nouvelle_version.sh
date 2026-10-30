#!/bin/sh
# À lancer avant chaque publication : force les navigateurs à recharger les fichiers du site.
v=$(date +%Y%m%d%H%M%S)
printf '%s\n' "$v" > version.txt
sed -i "s#from \"./config.js?v=[^\"]*\"#from \"./config.js?v=$v\"#; s#from \"./ui.js?v=[^\"]*\"#from \"./ui.js?v=$v\"#" assets/js/app.js
echo "Version $v"
