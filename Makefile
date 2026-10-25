
all: files

TEXTURES = img/sticks.auto.png img/tiles.lars.png img/center.auto.png img/winds.lars.png

ICONS = img/icon-16.auto.png img/icon-32.auto.png img/icon-96.auto.png

.PHONY: parcel
parcel: files
	node run-parcel.js

.PHONY: server
server:
	cd server && yarn start

.PHONY: files
files: img/models.auto.glb $(ICONS)

#img/tiles.auto.png: img/tiles.svg
#	inkscape $< --export-filename=$@ --export-width=512 --export-background=#ffffff --export-background-opacity=1

#img/sticks.auto.png: img/sticks.svg
#	inkscape $< --export-filename=$@ --export-width=256 --export-height=512

#img/center.auto.png: img/center.svg
#	inkscape $< --export-filename=$@ --export-width=512 --export-height=512

#img/winds.auto.png: img/winds.svg
#	inkscape $< --export-filename=$@ --export-width=128 --export-height=64

#img/icon-%.auto.png: img/icon.svg
#	inkscape $< --export-filename=$@ --export-width=$*

#img/models.auto.glb: img/models.blend $(TEXTURES)
#	blender $< --background --python export.py -- $@

.PHONY: build
build: files
	rm -rf build
	./node_modules/.bin/parcel build *.html --public-url . --cache-dir .cache/build/ --out-dir build/ --no-source-maps

.PHONY: build-server
build-server:
	cd server && yarn build

.PHONY:
test:
	cd server && yarn test
