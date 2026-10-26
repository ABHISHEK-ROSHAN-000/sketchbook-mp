import * as THREE from 'three';
import { joinRoom } from 'trystero';
import { World } from './World';
import { Character } from '../characters/Character';
import { IUpdatable } from '../interfaces/IUpdatable';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SeatType } from '../enums/SeatType';
import type { VehicleAnimationState } from '../vehicles/Vehicle';

export type PlayerNetState = {
	x: number;
	y: number;
	z: number;
	qx: number;
	qy: number;
	qz: number;
	qw: number;
	dirX: number;
	dirZ: number;
	anim: string;
	name: string;
	vx: number;
	vy: number;
	vz: number;
	inVehicle: boolean;
	vehicleNetId: string | null;
	seatIndex: number;
	attachedToSeat: boolean;
	doorRotation: number | null;
};

export type ChatNetMessage = {
	sender: string;
	text: string;
};

export type VehicleNetState = {
	netId: string;
	x: number; y: number; z: number;
	qx: number; qy: number; qz: number; qw: number;
	vx: number; vy: number; vz: number;
	avx: number; avy: number; avz: number;
	animation?: VehicleAnimationState;
};

type TrysteroSendOptions = {
	target?: string | string[] | null;
	metadata?: any;
	onProgress?: any;
	signal?: any;
};

type RemotePlayer = {
	char: Character;
	currentPos: THREE.Vector3;
	targetPos: THREE.Vector3;
	targetDir: THREE.Vector3;
	currentAnim: string;
	velocity: THREE.Vector3;
	targetQuat: THREE.Quaternion;
	currentVehicleNetId: string | null;
	currentSeatIndex: number;
	doorRotation: number | null;
	displayName: string;
	nameSprite: THREE.Sprite;
};

export class MultiplayerManager implements IUpdatable
{
	public updateOrder: number = 1;

	public world: World;
	public localPlayer: Character;
	public room: ReturnType<typeof joinRoom> | null = null;
	public remotePlayers: Map<string, RemotePlayer> = new Map();
	public playerName: string = '';
	private nameChosen: boolean = false;

	private remoteVehicles: Map<string, {
		targetPos: THREE.Vector3;
		targetQuat: THREE.Quaternion;
		vel: THREE.Vector3;
		angVel: THREE.Vector3;
		animation: VehicleAnimationState;
		lastSeen: number;
	}> = new Map();

	private sendState: ((state: PlayerNetState, options?: TrysteroSendOptions) => Promise<void>) | null = null;
	private sendChat: ((message: ChatNetMessage, options?: TrysteroSendOptions) => Promise<void>) | null = null;
	private sendVehicle: ((state: VehicleNetState, options?: TrysteroSendOptions) => Promise<void>) | null = null;
	private syncTimer: number = 0;
	private sentHistory: string[] = [];
	private sentHistoryIndex: number = -1;
	private audioListener?: THREE.AudioListener;
	private localStream?: MediaStream;
	private audioContext?: AudioContext;
	private pendingStreams: Map<string, MediaStream> = new Map();
	private pendingSpawns: Set<string> = new Set();
	private voiceMuted: boolean = false;

	constructor(world: World)
	{
		this.world = world;
		this.world.registerUpdatable(this);
		this.setupNamePrompt();
		this.setupChatAndVoiceUI();
	}

	private setupNamePrompt(): void
	{
		const setup = () => {
			const modal = document.getElementById('mp-name-modal') as HTMLElement | null;
			const input = document.getElementById('mp-name-input') as HTMLInputElement | null;
			const joinBtn = document.getElementById('mp-join-btn') as HTMLButtonElement | null;
			if (!modal || !input || !joinBtn) return;

			const saved = sessionStorage.getItem('mp_player_name') || '';
			if (saved) input.value = saved;
			setTimeout(() => input.focus(), 50);

			const submitName = () => {
				const trimmed = input.value.trim().slice(0, 16) || ('Player_' + Math.floor(100 + Math.random() * 900));
				this.playerName = trimmed;
				this.nameChosen = true;
				sessionStorage.setItem('mp_player_name', trimmed);
				if (this.localPlayer) this.localPlayer.name = trimmed;
				modal.style.display = 'none';
				if (this.localPlayer && this.room === null)
				{
					this.connectToRoom();
				}
			};

			joinBtn.addEventListener('click', submitName);
			input.addEventListener('keydown', (e) => {
				if (e.key === 'Enter')
				{
					e.preventDefault();
					submitName();
				}
			});
		};

		if (document.readyState === 'loading')
		{
			window.addEventListener('DOMContentLoaded', setup);
		}
		else
		{
			setup();
		}
	}

	private setupChatAndVoiceUI(): void
	{
		const chatLog = document.getElementById('mp-chat-log') as HTMLElement | null;
		const chatInputRow = document.getElementById('mp-chat-input-row') as HTMLElement | null;
		const chatInput = document.getElementById('mp-chat-input') as HTMLInputElement | null;
		const voiceBtn = document.getElementById('mp-voice-btn') as HTMLButtonElement | null;
		const inviteBtn = document.getElementById('mp-invite-btn') as HTMLButtonElement | null;

		const openChat = (initialText: string = '') => {
			if (!chatLog || !chatInputRow || !chatInput) return;
			const nameModal = document.getElementById('mp-name-modal');
			if (nameModal && nameModal.style.display !== 'none') return;
			this.localPlayer?.resetControls?.();
			(this.localPlayer?.controlledObject as any)?.resetControls?.();
			document.exitPointerLock();
			chatLog.classList.add('chat-open');
			chatInputRow.style.display = 'block';
			chatInput.value = initialText;
			chatInput.focus();
			this.sentHistoryIndex = -1;
			chatLog.scrollTop = chatLog.scrollHeight;
		};

		const closeChat = () => {
			if (!chatLog || !chatInputRow || !chatInput) return;
			chatLog.classList.remove('chat-open');
			chatInputRow.style.display = 'none';
			chatInput.blur();
			this.world.renderer?.domElement.requestPointerLock();
		};

		const sendChatMessage = () => {
			if (!chatInput) return;
			const text = chatInput.value.trim();
			if (!text) { closeChat(); return; }
			const sender = this.playerName || this.localPlayer?.name || 'Player';
			this.addPlayerChatMessage(sender, text);
			this.sendChat?.({ sender, text });
			this.sentHistory.push(text);
			this.sentHistoryIndex = -1;
			closeChat();
		};

		if (chatInput) {
			chatInput.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					sendChatMessage();
				} else if (e.key === 'Escape') {
					e.preventDefault();
					closeChat();
				} else if (e.key === 'ArrowUp') {
					e.preventDefault();
					if (this.sentHistory.length) {
						this.sentHistoryIndex = Math.min(this.sentHistory.length - 1, this.sentHistoryIndex + 1);
						chatInput.value = this.sentHistory[this.sentHistory.length - 1 - this.sentHistoryIndex];
					}
				} else if (e.key === 'ArrowDown') {
					e.preventDefault();
					if (this.sentHistoryIndex > 0) {
						this.sentHistoryIndex--;
						chatInput.value = this.sentHistory[this.sentHistory.length - 1 - this.sentHistoryIndex];
					} else {
						this.sentHistoryIndex = -1;
						chatInput.value = '';
					}
				}
			});
		}

		document.addEventListener('keydown', (e) => {
			if (e.key === 't' || e.key === 'T') {
				if (document.activeElement?.tagName === 'INPUT') return;
				const nameModal = document.getElementById('mp-name-modal');
				if (nameModal && nameModal.style.display !== 'none') return;
				e.preventDefault();
				openChat();
			} else if (e.key === '/' && (e.code === 'Slash')) {
				if (document.activeElement?.tagName === 'INPUT') return;
				const nameModal = document.getElementById('mp-name-modal');
				if (nameModal && nameModal.style.display !== 'none') return;
				e.preventDefault();
				if (chatInput) {
					openChat('/');
				}
			} else if (e.key === 'm' || e.key === 'M') {
				if (document.activeElement?.tagName === 'INPUT') return;
				this.toggleVoiceMute();
			}
		});

		if (inviteBtn) {
			inviteBtn.addEventListener('click', async () => {
				try {
					const url = new URL(window.location.href);
					if (!url.searchParams.has('room')) url.searchParams.set('room', 'sketchbook-friends');
					window.history.replaceState({}, '', url.toString());
					await navigator.clipboard.writeText(url.toString());
					const orig = inviteBtn.textContent;
					inviteBtn.textContent = 'Copied!';
					setTimeout(() => { inviteBtn.textContent = orig; }, 2000);
					this.addSystemChatMessage('Invite link copied to clipboard!');
				} catch {}
			});
		}

		if (voiceBtn) {
			voiceBtn.addEventListener('click', () => this.toggleVoiceMute());
		}

		if (!this.audioListener && this.world.camera) {
			this.audioListener = new THREE.AudioListener();
			this.world.camera.add(this.audioListener);
		}
	}

	private addChatLine(text: string, isSystem: boolean = false): void
	{
		const log = document.getElementById('mp-chat-log');
		if (!log) return;
		const line = document.createElement('div');
		line.className = 'mc-chat-line';
		if (isSystem) {
			line.style.color = '#ffff55';
		} else {
			line.style.color = '#ffffff';
		}
		line.textContent = text;
		log.appendChild(line);
		while (log.children.length > 60) log.removeChild(log.firstChild!);
		log.scrollTop = log.scrollHeight;
		setTimeout(() => {
			line.classList.add('faded');
		}, 6000);
	}

	public addPlayerChatMessage(sender: string, text: string): void
	{
		this.addChatLine(`<${sender}> ${text}`, false);
	}

	public addSystemChatMessage(text: string): void
	{
		this.addChatLine(text, true);
	}

	private toggleVoiceMute(): void
	{
		const voiceBtn = document.getElementById('mp-voice-btn') as HTMLButtonElement | null;
		if (!this.audioListener && this.world.camera) {
			this.audioListener = new THREE.AudioListener();
			this.world.camera.add(this.audioListener);
		}
		const ctx = (this.audioListener as any)?.context as AudioContext | undefined;
		if (ctx && ctx.state === 'suspended') {
			ctx.resume().catch(() => {});
		}
		if (!this.localStream) {
			navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
				.then(stream => {
					this.localStream = stream;
					if (ctx && ctx.state === 'suspended') {
						ctx.resume().catch(() => {});
					}
					if (this.room && (this.room as any).addStream) {
						(this.room as any).addStream(stream);
					}
					if (voiceBtn) {
						voiceBtn.textContent = 'Mic: ON (M)';
						voiceBtn.style.borderColor = '#52a535';
					}
					this.addSystemChatMessage('Voice chat enabled (3D Proximity)');
				})
				.catch(() => {});
			return;
		}
		this.voiceMuted = !this.voiceMuted;
		this.localStream.getAudioTracks().forEach(t => t.enabled = !this.voiceMuted);
		if (voiceBtn) {
			voiceBtn.textContent = this.voiceMuted ? 'Mic: MUTED (M)' : 'Mic: ON (M)';
			voiceBtn.style.borderColor = this.voiceMuted ? '#d9534f' : '#52a535';
		}
		this.addSystemChatMessage(this.voiceMuted ? 'Voice chat muted' : 'Voice chat unmuted');
	}

	private attachVoiceStream(peerId: string, stream: MediaStream): void
	{
		if (!this.audioListener && this.world.camera) {
			this.audioListener = new THREE.AudioListener();
			this.world.camera.add(this.audioListener);
		}
		const listener = this.audioListener;
		if (!listener) return;
		const ctx = (listener as any)?.context as AudioContext | undefined;
		if (ctx && ctx.state === 'suspended') {
			ctx.resume().catch(() => {});
		}
		const audio = new THREE.PositionalAudio(listener);
		audio.setMediaStreamSource(stream);
		audio.setRefDistance(6);
		audio.setMaxDistance(60);
		audio.setRolloffFactor(1.2);
		const el = document.createElement('audio');
		el.srcObject = stream;
		el.muted = true;
		el.play().catch(() => {});
		const remote = this.remotePlayers.get(peerId);
		if (remote && remote.char) {
			remote.char.add(audio);
		} else {
			this.pendingStreams.set(peerId, stream);
		}
	}

	public setLocalPlayer(player: Character): void
	{
		this.localPlayer = player;
		if (this.playerName) {
			this.localPlayer.name = this.playerName;
		}
		if (this.nameChosen && this.room === null) {
			this.connectToRoom();
		}
		this.world.timeScaleTarget = 1;
	}

	private connectToRoom(): void
	{
		try {
			if (this.room !== null) return;

			const params = new URLSearchParams(window.location.search);
			const roomCode = params.get('room') || 'sketchbook-friends';

			this.room = joinRoom({ appId: 'sketchbook-openworld-mp' }, roomCode, {
				onJoinError: (details: any) => { console.error('Sketchbook multiplayer join error:', details); },
			});

			const handlePeerStream = (stream: MediaStream, peerId: string) => {
				this.attachVoiceStream(peerId, stream);
			};
			if (typeof (this.room as any).onPeerStream === 'function') {
				(this.room as any).onPeerStream(handlePeerStream);
			} else {
				(this.room as any).onPeerStream = handlePeerStream;
			}

			this.room.onPeerJoin = (peerId: string) => {
				this.spawnRemoteFriend(peerId);
				if (this.localStream && (this.room as any)?.addStream) {
					try { (this.room as any).addStream(this.localStream, peerId); } catch {}
				}
			};
			this.room.onPeerLeave = (peerId: string) => { this.removeRemotePlayer(peerId); };

			if (this.localStream && (this.room as any)?.addStream) {
				try { (this.room as any).addStream(this.localStream); } catch {}
			}

			const stateAction = this.room.makeAction<PlayerNetState>('state');
			const chatAction = this.room.makeAction<ChatNetMessage>('chat');
			const vehicleAction = this.room.makeAction<VehicleNetState>('vehicle');

			stateAction.onMessage = (data: PlayerNetState, context: any) => {
				this.receiveState(data, context.peerId);
			};

			chatAction.onMessage = (data: ChatNetMessage, context: any) => {
				this.receiveChat(data, context.peerId);
			};

			vehicleAction.onMessage = (data: VehicleNetState, context: any) => {
				this.receiveVehicle(data);
			};

			this.sendState = (state: PlayerNetState, options?: TrysteroSendOptions) => stateAction.send(state, options);
			this.sendChat = (message: ChatNetMessage, options?: TrysteroSendOptions) => chatAction.send(message, options);
			this.sendVehicle = (state: VehicleNetState, options?: TrysteroSendOptions) => vehicleAction.send(state, options);

			this.world.timeScaleTarget = 1;
		} catch (err) {
			console.error('Multiplayer init error:', err);
			this.world.timeScaleTarget = 1;
		}
	}

	private receiveState(data: PlayerNetState, peerId: string): void
	{
		const remote = this.remotePlayers.get(peerId);
		if (remote === undefined) return;

		remote.targetPos.set(data.x, data.y, data.z);
		remote.targetDir.set(data.dirX, 0, data.dirZ);
		remote.targetQuat.set(data.qx, data.qy, data.qz, data.qw);
		remote.currentAnim = data.anim || 'idle';
		remote.velocity.set(data.vx, data.vy, data.vz);
		remote.doorRotation = (typeof data.doorRotation === 'number' && Number.isFinite(data.doorRotation))
			? data.doorRotation
			: null;

		if (data.name && data.name !== remote.displayName)
		{
			const wasEmpty = !remote.displayName;
			remote.displayName = data.name;
			this.updateNameplateSprite(remote.nameSprite, data.name);
			if (wasEmpty) {
				this.addSystemChatMessage(`${data.name} joined the game`);
			}
		}

		const char = remote.char;
		if (char.currentAnimationName !== remote.currentAnim)
		{
			char.setAnimation(remote.currentAnim, 0.1);
		}

		this.syncRemotePlayerSeat(remote, data.vehicleNetId, data.seatIndex, data.attachedToSeat);
	}

	private getLocalSeatInfo()
	{
		const activeSeat = this.localPlayer?.occupyingSeat || this.localPlayer?.vehicleEntryInstance?.targetSeat || null;
		const seatVehicle = activeSeat
			? this.world.vehicles.find((v) => v.seats.indexOf(activeSeat) !== -1) || null
			: null;
		const vehicleNetId: string | null = (seatVehicle && seatVehicle.netId) ? seatVehicle.netId : null;
		const seatIndex: number = (seatVehicle && activeSeat) ? seatVehicle.seats.indexOf(activeSeat) : -1;

		const attachedToSeat: boolean = Boolean(
			activeSeat &&
			seatVehicle &&
			this.localPlayer.parent &&
			this.localPlayer.parent !== this.world.graphicsWorld
		);
		const doorRotation: number | null = activeSeat?.door ? activeSeat.door.rotation : null;

		const netPos = new THREE.Vector3();
		const netQuat = new THREE.Quaternion();

		if (attachedToSeat && seatVehicle)
		{
			const vehObj = seatVehicle as unknown as THREE.Object3D;
			if (this.localPlayer.parent === vehObj)
			{
				// Already in seatVehicle local space (constant while seated!)
				netPos.copy(this.localPlayer.position);
				netQuat.copy(this.localPlayer.quaternion);
			}
			else
			{
				// Convert from child node (e.g. seatPointObject) into seatVehicle local space
				vehObj.updateMatrixWorld(true);
				this.localPlayer.getWorldPosition(netPos);
				vehObj.worldToLocal(netPos);

				const vehWorldQuat = new THREE.Quaternion();
				vehObj.getWorldQuaternion(vehWorldQuat);
				this.localPlayer.getWorldQuaternion(netQuat);
				netQuat.premultiply(vehWorldQuat.inverse());
			}
		}
		else if (this.localPlayer)
		{
			this.localPlayer.getWorldPosition(netPos);
			this.localPlayer.getWorldQuaternion(netQuat);
		}

		return { vehicleNetId, seatIndex, attachedToSeat, netPos, netQuat, doorRotation };
	}

	private getSeatLocalTransform(vehicle: any, seat: any): { pos: THREE.Vector3; quat: THREE.Quaternion }
	{
		const vehObj = vehicle as unknown as THREE.Object3D;
		vehObj.updateMatrixWorld(true);

		const pos = new THREE.Vector3();
		seat.seatPointObject.getWorldPosition(pos);
		vehObj.worldToLocal(pos);
		pos.y += 0.6;

		const vehWorldQuat = new THREE.Quaternion();
		const seatWorldQuat = new THREE.Quaternion();
		vehObj.getWorldQuaternion(vehWorldQuat);
		seat.seatPointObject.getWorldQuaternion(seatWorldQuat);
		const quat = seatWorldQuat.premultiply(vehWorldQuat.inverse());

		return { pos, quat };
	}

	private createNameplateSprite(name: string): THREE.Sprite
	{
		const material = new THREE.SpriteMaterial({
			transparent: true,
			depthTest: true,
			depthWrite: false
		});
		const sprite = new THREE.Sprite(material);
		// Position directly above boxman.glb's head ( never created for localPlayer )
		sprite.position.set(0, 0.65, 0);
		this.updateNameplateSprite(sprite, name);
		return sprite;
	}

	private updateNameplateSprite(sprite: THREE.Sprite, name: string): void
	{
		const label = (name || 'Player').trim().slice(0, 16);
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d')!;
		const fontSize = 36;
		const font = `bold ${fontSize}px monospace, sans-serif`;
		ctx.font = font;

		const textWidth = Math.ceil(ctx.measureText(label).width);
		const padX = 24;
		const padY = 14;
		canvas.width = Math.max(64, textWidth + padX * 2);
		canvas.height = fontSize + padY * 2;

		// Minecraft-style dark translucent plate behind the name
		ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		// Crisp white text with subtle shadow
		ctx.font = font;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
		ctx.fillText(label, canvas.width / 2 + 2, canvas.height / 2 + 2);
		ctx.fillStyle = '#ffffff';
		ctx.fillText(label, canvas.width / 2, canvas.height / 2);

		const texture = new THREE.CanvasTexture(canvas);
		texture.minFilter = THREE.LinearFilter;
		texture.magFilter = THREE.LinearFilter;
		texture.needsUpdate = true;

		const mat = sprite.material as THREE.SpriteMaterial;
		if (mat.map) mat.map.dispose();
		mat.map = texture;
		mat.needsUpdate = true;

		// Scale proportionally so text never stretches
		const heightWorld = 0.24;
		const widthWorld = heightWorld * (canvas.width / canvas.height);
		sprite.scale.set(widthWorld, heightWorld, 1);
	}

	private freePreviousSeat(remote: RemotePlayer): void
	{
		const char = remote.char;
		if (remote.currentVehicleNetId !== null && remote.currentSeatIndex >= 0)
		{
			const oldVehicle = this.world.vehicles.find((v) => v.netId === remote.currentVehicleNetId);
			const oldSeat = (oldVehicle && remote.currentSeatIndex < oldVehicle.seats.length)
				? oldVehicle.seats[remote.currentSeatIndex]
				: null;
			if (oldSeat)
			{
				if (oldSeat.occupiedBy === char)
				{
					oldSeat.occupiedBy = null;
				}
				oldSeat.door?.close();
			}
		}
	}

	private syncRemotePlayerSeat(
		remote: RemotePlayer,
		vehicleNetId: string | null,
		seatIndex: number,
		attachedToSeat: boolean
	): void
	{
		const char = remote.char;
		const hasSeat = vehicleNetId !== null && seatIndex >= 0;

		if (hasSeat)
		{
			const vehicle = this.world.vehicles.find((v) => v.netId === vehicleNetId);
			const seat = (vehicle && seatIndex >= 0 && seatIndex < vehicle.seats.length)
				? vehicle.seats[seatIndex]
				: null;

			if (vehicle && seat)
			{
				if (remote.currentVehicleNetId !== vehicleNetId || remote.currentSeatIndex !== seatIndex)
				{
					this.freePreviousSeat(remote);
					remote.currentVehicleNetId = vehicleNetId;
					remote.currentSeatIndex = seatIndex;
				}

				if (!seat.occupiedBy || seat.occupiedBy === char) {
					seat.occupiedBy = char;
				} else {
					// Seat taken by another player; don't steal it.
					return;
				}
				const vehObj = vehicle as unknown as THREE.Object3D;

				if (attachedToSeat)
				{
					char.occupyingSeat = seat;
					// Reset any leftover running lean/tilt on tiltContainer so seated avatar sits straight
					if (char.tiltContainer)
					{
						char.tiltContainer.rotation.set(0, 0, 0);
						char.tiltContainer.position.set(0, 0, 0);
					}
					if (char.modelContainer)
					{
						char.modelContainer.quaternion.set(0, 0, 0, 1);
					}
					if (char.parent !== vehObj)
					{
						vehObj.add(char);
						const seatTransform = this.getSeatLocalTransform(vehicle, seat);
						// Use network vehicle-local targetPos if already valid, otherwise snap to exact seat transform
						if (remote.targetPos.lengthSq() > 0.01 && remote.targetPos.distanceToSquared(seatTransform.pos) < 4)
						{
							remote.currentPos.copy(remote.targetPos);
						}
						else
						{
							remote.currentPos.copy(seatTransform.pos);
							remote.targetPos.copy(seatTransform.pos);
							remote.targetQuat.copy(seatTransform.quat);
						}
						char.position.copy(remote.currentPos);
						char.quaternion.copy(remote.targetQuat);
						char.updateMatrixWorld(true);
					}
				}
				else
				{
					char.occupyingSeat = null;
					if (char.parent !== this.world.graphicsWorld)
					{
						this.world.graphicsWorld.add(char);
						remote.currentPos.copy(remote.targetPos);
						char.setPosition(remote.currentPos.x, remote.currentPos.y, remote.currentPos.z);
					}
				}
				return;
			}
		}

		this.clearRemoteSeat(remote);
		remote.currentVehicleNetId = null;
		remote.currentSeatIndex = -1;
	}

	private clearRemoteSeat(remote: RemotePlayer): void
	{
		const char = remote.char;
		this.freePreviousSeat(remote);

		let wasAttached = false;
		let worldPos = new THREE.Vector3();
		if (char.occupyingSeat && char.parent && char.parent !== this.world.graphicsWorld)
		{
			wasAttached = true;
			const vehObj = char.occupyingSeat.vehicle as unknown as THREE.Object3D;
			vehObj.updateMatrixWorld(true);
			char.getWorldPosition(worldPos);
		}

		if (char.occupyingSeat)
		{
			if (char.occupyingSeat.occupiedBy === char)
			{
				char.occupyingSeat.occupiedBy = null;
			}
			char.occupyingSeat = null;
		}

		if (char.parent !== this.world.graphicsWorld)
		{
			this.world.graphicsWorld.add(char);
			if (wasAttached)
			{
				remote.currentPos.copy(worldPos);
				char.setPosition(worldPos.x, worldPos.y, worldPos.z);
			}
			else
			{
				remote.currentPos.copy(remote.targetPos);
				char.setPosition(remote.currentPos.x, remote.currentPos.y, remote.currentPos.z);
			}
			char.updateMatrixWorld(true);
		}
	}

	private receiveChat(data: ChatNetMessage, peerId: string): void
	{
		console.log(`[${data.sender}]: ${data.text}`);
		this.addPlayerChatMessage(data.sender, data.text);
	}

	private receiveVehicle(data: VehicleNetState): void
	{
		this.remoteVehicles.set(data.netId, {
			targetPos: new THREE.Vector3(data.x, data.y, data.z),
			targetQuat: new THREE.Quaternion(data.qx, data.qy, data.qz, data.qw),
			vel: new THREE.Vector3(data.vx, data.vy, data.vz),
			angVel: new THREE.Vector3(data.avx, data.avy, data.avz),
			animation: data.animation || {},
			lastSeen: performance.now()
		});
	}

	private spawnRemoteFriend(peerId: string): void
	{
		if (this.pendingSpawns.has(peerId)) return;
		this.pendingSpawns.add(peerId);

		const loader = new GLTFLoader();
		loader.load('build/assets/boxman.glb', (gltf) =>
		{
			if (!this.pendingSpawns.has(peerId)) return;
			this.pendingSpawns.delete(peerId);

			const friend = new Character(gltf);
			friend.isRemote = true;
			this.world.add(friend);
			friend.setPhysicsEnabled(false);

			const startPos = new THREE.Vector3(0, 2, 0);
			const nameSprite = this.createNameplateSprite('Player');
			friend.add(nameSprite);
			this.remotePlayers.set(peerId, {
				char: friend,
				currentPos: startPos.clone(),
				targetPos: startPos.clone(),
				targetDir: new THREE.Vector3(0, 0, 1),
				currentAnim: 'idle',
				velocity: new THREE.Vector3(),
				targetQuat: new THREE.Quaternion(),
				currentVehicleNetId: null,
				currentSeatIndex: -1,
				doorRotation: null,
				displayName: '',
				nameSprite,
			});
			const pending = this.pendingStreams.get(peerId);
			if (pending) {
				this.attachVoiceStream(peerId, pending);
				this.pendingStreams.delete(peerId);
			}

			if (this.localPlayer) {
				const seatInfo = this.getLocalSeatInfo();
				this.sendState?.(
					{
						x: seatInfo.netPos.x,
						y: seatInfo.netPos.y,
						z: seatInfo.netPos.z,
						qx: seatInfo.netQuat.x,
						qy: seatInfo.netQuat.y,
						qz: seatInfo.netQuat.z,
						qw: seatInfo.netQuat.w,
						dirX: this.localPlayer.orientation.x,
						dirZ: this.localPlayer.orientation.z,
						anim: this.localPlayer.currentAnimationName,
						name: this.playerName || this.localPlayer.name || 'Player',
						vx: 0, vy: 0, vz: 0,
						inVehicle: seatInfo.attachedToSeat,
						vehicleNetId: seatInfo.vehicleNetId,
						seatIndex: seatInfo.seatIndex,
						attachedToSeat: seatInfo.attachedToSeat,
						doorRotation: seatInfo.doorRotation
					},
					{ target: peerId }
				);
			}

			this.world.timeScaleTarget = 1;
		});
	}

	private removeRemotePlayer(peerId: string): void
	{
		this.pendingSpawns.delete(peerId);
		const remote = this.remotePlayers.get(peerId);
		if (remote !== undefined)
		{
			if (remote.displayName) {
				this.addSystemChatMessage(`${remote.displayName} left the game`);
			}
			this.freePreviousSeat(remote);
			if (remote.char.occupyingSeat)
			{
				remote.char.occupyingSeat.door?.close();
				if (remote.char.occupyingSeat.occupiedBy === remote.char)
				{
					remote.char.occupyingSeat.occupiedBy = null;
				}
				remote.char.occupyingSeat = null;
			}
			this.world.remove(remote.char);
			this.remotePlayers.delete(peerId);
		}
	}

	public update(timeStep: number, unscaledTimeStep: number): void
	{
		if (this.localPlayer === undefined || this.room === null) return;

		this.syncTimer += unscaledTimeStep;
		if (this.syncTimer >= 0.033)
		{
			this.syncTimer = 0;

			const { vehicleNetId, seatIndex, attachedToSeat, netPos, netQuat, doorRotation } = this.getLocalSeatInfo();

			const body = this.localPlayer.characterCapsule?.body;
			const vel = (!attachedToSeat && body) ? new THREE.Vector3(body.velocity.x, body.velocity.y, body.velocity.z) : new THREE.Vector3();
			this.sendState?.({
				x: netPos.x,
				y: netPos.y,
				z: netPos.z,
				qx: netQuat.x, qy: netQuat.y, qz: netQuat.z, qw: netQuat.w,
				dirX: this.localPlayer.orientation.x,
				dirZ: this.localPlayer.orientation.z,
				anim: this.localPlayer.currentAnimationName,
				name: this.playerName || this.localPlayer.name || 'Player',
				vx: vel.x, vy: vel.y, vz: vel.z,
				inVehicle: attachedToSeat,
				vehicleNetId,
				seatIndex,
				attachedToSeat,
				doorRotation
			});

			// Only the DRIVER broadcasts vehicle physics. Passengers ride along.
			const drivenVehicle = (this.localPlayer.controlledObject as any);
			if (drivenVehicle && drivenVehicle.collision && drivenVehicle.netId) {
				const b = drivenVehicle.collision;
				this.sendVehicle?.({
					netId: drivenVehicle.netId,
					x: b.position.x, y: b.position.y, z: b.position.z,
					qx: b.quaternion.x, qy: b.quaternion.y, qz: b.quaternion.z, qw: b.quaternion.w,
					vx: b.velocity.x, vy: b.velocity.y, vz: b.velocity.z,
					avx: b.angularVelocity.x, avy: b.angularVelocity.y, avz: b.angularVelocity.z,
					animation: drivenVehicle.getNetworkAnimationState()
				});
			}
		}

		const dt = Math.min(unscaledTimeStep, 0.1);
		const charAlpha = 1 - Math.exp(-18 * dt);

		// Update remote vehicle transforms FIRST so seat world matrices are current before drawing seated characters
		const vehAlpha = 1 - Math.exp(-16 * dt);
		const now = performance.now();
		const drivenVehicle = (this.localPlayer.controlledObject as any);

		this.remoteVehicles.forEach((vState, netId) => {
			const vehicle = this.world.vehicles.find((v) => v.netId === netId);
			if (!vehicle) return;

			// Skip applying our own vehicle state — we drive it locally.
			if (drivenVehicle && drivenVehicle.netId === netId)
			{
				vehicle.isRemote = false;
				this.remoteVehicles.delete(netId);
				return;
			}

			if (now - vState.lastSeen > 600)
			{
				// Driver stopped sending; stop visual effects instead of leaving rotors spinning.
				vehicle.applyNetworkAnimationState({
					enginePower: 0,
					steering: 0,
					aileron: 0,
					elevator: 0,
					rudder: 0
				});
				this.remoteVehicles.delete(netId);
				return;
			}

			vehicle.applyNetworkAnimationState(vState.animation);
			if (!vehicle.collision) return;

			vState.targetPos.addScaledVector(vState.vel, dt * 0.85);
			vehicle.position.lerp(vState.targetPos, vehAlpha);
			vehicle.quaternion.slerp(vState.targetQuat, vehAlpha);

			const b = vehicle.collision;
			b.position.set(vehicle.position.x, vehicle.position.y, vehicle.position.z);
			b.previousPosition.copy(b.position);
			b.interpolatedPosition.copy(b.position);

			b.quaternion.set(vehicle.quaternion.x, vehicle.quaternion.y, vehicle.quaternion.z, vehicle.quaternion.w);

			b.velocity.set(vState.vel.x, vState.vel.y, vState.vel.z);
			b.angularVelocity.set(vState.angVel.x, vState.angVel.y, vState.angVel.z);
			vehicle.updateMatrixWorld(true);
		});

		this.remotePlayers.forEach((remote) =>
		{
			const char = remote.char;

			// The player using a seat owns that door's animation, including while walking to/from the vehicle.
			if (remote.doorRotation !== null && remote.currentVehicleNetId !== null && remote.currentSeatIndex >= 0)
			{
				const doorVehicle = this.world.vehicles.find((v) => v.netId === remote.currentVehicleNetId);
				const doorSeat = (doorVehicle && remote.currentSeatIndex < doorVehicle.seats.length)
					? doorVehicle.seats[remote.currentSeatIndex]
					: null;

				if (doorSeat?.door)
				{
					const targetDoorRotation = THREE.MathUtils.clamp(remote.doorRotation, 0, 1);
					const doorAlpha = 1 - Math.exp(-25 * dt);
					const nextDoorRotation = THREE.MathUtils.lerp(doorSeat.door.rotation, targetDoorRotation, doorAlpha);

					doorSeat.door.setRemoteRotation(
						Math.abs(nextDoorRotation - targetDoorRotation) < 0.005
							? targetDoorRotation
							: nextDoorRotation
					);
				}
			}

			// Seated remote: stay locked to the vehicle hierarchy so the avatar NEVER skids/lags
			// behind the car and ALWAYS faces the front of the vehicle.
			if (char.occupyingSeat && char.parent && char.parent !== this.world.graphicsWorld)
			{
				const seat = char.occupyingSeat;
				const seatTransform = this.getSeatLocalTransform(char.parent, seat);

				// Smoothly follow vehicle-local targetPos during entry/seat-switch, and lock to the seat offset once seated
				if (remote.targetPos.lengthSq() > 0.01 && remote.targetPos.distanceToSquared(seatTransform.pos) < 4)
				{
					if (remote.currentPos.distanceToSquared(remote.targetPos) > 4 || remote.currentPos.distanceToSquared(remote.targetPos) < 0.0005)
					{
						remote.currentPos.copy(remote.targetPos);
					}
					else
					{
						remote.currentPos.lerp(remote.targetPos, charAlpha);
					}
					char.position.copy(remote.currentPos);
					char.quaternion.slerp(remote.targetQuat, charAlpha);
				}
				else
				{
					remote.currentPos.copy(seatTransform.pos);
					char.position.copy(seatTransform.pos);
					char.quaternion.copy(seatTransform.quat);
				}

				char.modelContainer.quaternion.set(0, 0, 0, 1);
				char.tiltContainer.rotation.set(0, 0, 0);
				char.tiltContainer.position.set(0, 0, 0);
				char.updateMatrixWorld(true);
				return;
			}

			// On-foot remote: world-space dead-reckoning + smooth rotation
			remote.targetPos.addScaledVector(remote.velocity, dt * 0.85);
			if (remote.currentPos.distanceToSquared(remote.targetPos) > 100) {
				remote.currentPos.copy(remote.targetPos);
			} else {
				remote.currentPos.lerp(remote.targetPos, charAlpha);
			}
			char.setPosition(remote.currentPos.x, remote.currentPos.y, remote.currentPos.z);
			char.setOrientation(remote.targetDir, false);
		});
	}
}
