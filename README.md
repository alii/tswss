# tswss

A TypeScript friendly WebSocket server, with a built-in heartbeat.

```ts
import { TSWSS } from "tswss";

type Send = {
	hello: "world";
};

// The data you might expect to receive from the client
type Recv = {
	foo: "bar";
};

const server = new TSWSS<Send, Recv>({
	port: 8080,

	encode: data => JSON.stringify(data),

	// Throwing inside the `.decode()` method will
	// disregard the incoming data, but the connection will remain open
	decode: data => JSON.parse(data.toString()),
});

server.on("message", (socket, data) => {
	// Typed recv data
	console.log(data.foo);

	// Typed send data
	socket.send({ hello: "world" });
});

server.on("connection", socket => {
	console.log("Connected", socket);
});
```
