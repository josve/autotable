
.PHONY: files
files: img/models.auto.glb

img/tiles.auto.png: img/tiles.svg
	inkscape $< --export-png=$@ --export-width=512

img/sticks.auto.png: img/sticks.svg
	inkscape $< --export-png=$@ --export-width=256 --export-height=512

img/models.auto.glb: img/models.blend img/sticks.auto.png img/tiles.auto.png
	blender $< --background --python export.py -- $@

.PHONY: build
build: files
	rm -rf build
	./node_modules/.bin/parcel build index.html --public-url /autotable/ --cache-dir .cache/build/ --out-dir build/

.PHONY: deploy
deploy: build
	rsync -rva --checksum --delete build/ pwmarcz.pl:homepage/autotable/
