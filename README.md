<p align="center">
	<a href="https://jblaha.art/sketchbook/latest"><img src="./src/img/thumbnail.png"></a>
	<br>
	<a href="https://jblaha.art/sketchbook/latest">Live demo</a>
	<br>
</p>

# Final update (20. Feb 2023)

As I have no more interest in developing this project, it comes to a conclusion. In order to remain honest about the true state of the project, I am archiving this repository.

- If you wish to modify Sketchbook feel free to fork it.


# 📒 Sketchbook

Simple web based game engine built on three.js and cannon.js focused on third-person character controls and related gameplay mechanics.

Mostly a playground for exploring how conventional third person gameplay mechanics found in modern games work and recreating them in a general way.

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
3. Run `npm install`
4. Run `npm run dev`
5. Make changes and test them out at http://localhost:8080

## Credits

