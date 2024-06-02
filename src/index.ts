import { EventBus } from "alistair/bus";
import { WebSocketServer, type ServerOptions, type WebSocket } from "ws";

export type NativeTimeout = ReturnType<typeof setTimeout>;

export type BufferLike =
	| string
	| Buffer
	| DataView
	| number
	| ArrayBufferView
	| Uint8Array
	| ArrayBuffer
	| SharedArrayBuffer
	| readonly any[]
	| readonly number[]
	| { valueOf(): ArrayBuffer }
	| { valueOf(): SharedArrayBuffer }
	| { valueOf(): Uint8Array }
	| { valueOf(): readonly number[] }
	| { valueOf(): string }
	| { [Symbol.toPrimitive](hint: string): string };

export type Encode<T> = (data: T) => BufferLike;
export type Decode<T> = (data: BufferLike) => T;

export interface TSWSSOptions<Send, Recv> extends ServerOptions {
	encode: Encode<Send>;
	decode: Decode<Recv>;
	heartbeatInterval?: number;
}

export class TSWSSClient<Send> {
	private readonly socket: WebSocket;
	private readonly encode: Encode<Send>;

	public isAlive: boolean;

	public constructor(socket: WebSocket, encode: Encode<Send>) {
		this.socket = socket;
		this.isAlive = true;
		this.encode = encode;
	}

	public ping(): void {
		this.socket.ping();
	}

	public send(data: Send) {
		this.socket.send(this.encode(data));
	}

	/**
	 * Immediately terminate the connection, no waiting
	 */
	public terminate() {
		this.socket.terminate();
	}

	/**
	 * Close the connection, but waits for the close timer
	 */
	public close() {
		this.socket.close();
	}
}

export class TSWSS<Send, Recv> extends EventBus<{
	close: [];
	listening: [];
	message: [client: TSWSSClient<Send>, data: Recv];
	connection: [client: TSWSSClient<Send>];
	disconnection: [client: TSWSSClient<Send>];
}> {
	protected readonly encode: Encode<Send>;
	protected readonly decode: Decode<Recv>;
	protected readonly server: WebSocketServer;
	protected readonly heartbeat: NativeTimeout;

	/**
	 * Stores the mapping of WebSocket to TSWSSClient, so our abstraction doesn't leak
	 */
	private readonly socketToClient = new WeakMap<WebSocket, TSWSSClient<Send>>();

	protected getSocketToClientMap() {
		return this.socketToClient;
	}

	public constructor(options: TSWSSOptions<Send, Recv>) {
		super();

		const { heartbeatInterval, encode, decode, ...rest } = options;

		this.encode = options.encode;
		this.decode = options.decode;

		this.server = new WebSocketServer(rest);

		this.server.on("listening", () => {
			this.emit("listening");
		});

		this.heartbeat = setInterval(() => {
			for (const socket of this.server.clients) {
				const client = this.socketToClient.get(socket);

				if (!client) {
					this.socketToClient.delete(socket);
					continue;
				}

				if (client.isAlive) {
					client.isAlive = false;
					client.ping();
				} else {
					client.terminate();
				}
			}
		}, options.heartbeatInterval ?? 5000);

		this.server.on("connection", wss => {
			const client = new TSWSSClient(wss, this.encode);

			wss.on("message", event => {
				client.isAlive = true;

				let data: Recv;

				try {
					// Behaviour is to ignore invalid messages as
					// the server "doesn't know how to handle them"
					data = this.decode(event as BufferLike);
				} catch {
					return;
				}

				this.emit("message", client, data);
			});

			wss.on("close", () => {
				this.emit("disconnection", client);
				this.socketToClient.delete(wss);
			});

			this.emit("connection", client);
		});

		this.server.on("close", () => {
			clearInterval(this.heartbeat);
			this.emit("close");
		});
	}

	public sendToAll(data: Send): void {
		const buffer = this.encode(data);

		for (const client of this.server.clients) {
			client.send(buffer);
		}
	}
}
