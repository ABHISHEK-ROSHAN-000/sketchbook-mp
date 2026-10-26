# 📒 Sketchbook

Sketchbook is a web-based 3D playground built on three.js and cannon.js, focused on third-person character controls and related gameplay mechanics. It's a place to explore how conventional third-person mechanics found in modern games work — and to recreate them in a general, reusable way.

Drive cars, fly airplanes, pilot helicopters, and move around with a raycast character controller featuring capsule collisions and a dynamic camera.

## Features

* World
	* Three.js scene
	* Cannon.js physics
	* Variable timescale
	* Frame skipping
	* FXAA anti-aliasing
* Characters
	* Third-person camera
	* Raycast character controller with capsule collisions
	* General state system
	* Character AI
* Vehicles
	* Cars
	* Airplanes
	* Helicopters



## Usage

You can define your own scenes in Blender, and then read them with Sketchbook. Sketchbook needs to run on a local server such as [http-server](https://www.npmjs.com/package/http-server) to be able to load external assets.

<!-- #### Script tag -->

1. Import:

```html
<script src="sketchbook.min.js"></script>
```

2. Load a glb scene defined in Blender:

```javascript
const world = new Sketchbook.World('scene.glb');
```

<!--

#### NPM

1. Install:

```
npm i sketchbook
```

2. Import:

```javascript
import { World } from 'sketchbook';
```

3. Load a glb scene defined in Blender:

```javascript
const world = new World('scene.glb');
```

-->

## Contributing

1. Get the LTS version of [Node.js](https://nodejs.org/en/) 16
2. Run `npm install`
3. Run `npm run dev`
4. Make changes and test them out at http://localhost:8080

