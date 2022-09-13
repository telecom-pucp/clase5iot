const express = require("express");
const socketIO = require("socket.io");
const http = require("http");
const mqtt = require("mqtt");
const {Pool} = require('pg');

/******* postgres ******/
const poolPg = new Pool({
    host: "18.204.195.62",
    user: "postgres",
    password: "mysecretpassword",
    port: 5432,
    database: "clase4"
});

poolPg.on("error", (err, client) => {
    console.error("error", err);
});

/**********************/

//inicialización de variables
let app = express();
let server = http.Server(app);
let io = socketIO(server);

//arrancando el server
server.listen(3000, function () {
    console.log("server iniciado");
});

//routes
// otra forma para: app.get("/",function(req,res){
app.get("/", (req, res) => {
    res.sendFile(__dirname + "/index.html");
});

let cantClientConectados = 0;
let clientes = [];

//SocketIO
io.on("connection", function (socket) {
    console.log("nuevo cliente con id: " + socket.id);
    cantClientConectados++;
    clientes.push(socket.id);
    io.emit("cantClienConn", cantClientConectados);

    //= a -->  socket.on("disconnect",function(){
    socket.on("disconnect", () => {
        console.log("cliente desconectado con id: " + socket.id);
        cantClientConectados--;
        io.emit("cantClienConn", cantClientConectados);
    });
    socket.on("mensajeCli", function (data) {
        console.log("mensaje del cliente: " + data);
        switch (data) {
            case "1":
                io.emit("foco", "on");
                break;
            case "2":
                io.emit("foco", "off");
                break;
        }
    });
    socket.on("mensajeCli2", function (data) {
        console.log("mensaje del cliente input 2: " + data);
    });
});


/********* mqtt **********************************/
let clientMqtt = mqtt.connect({
    host: "18.204.195.62",
    port: 1883,
    username: "",
    password: ""
});

clientMqtt.on("connect", () => {
    console.log("conectado al broker de AWS");

    clientMqtt.subscribe("clase4");
    clientMqtt.subscribe("clase5");
});

clientMqtt.on("error", (error) => {
    console.error("error broker", error);
});

clientMqtt.on("message", (topic, data) => {
    //console.log("tópico recibido: ", topic);
    let dataString = data.toString();
    //console.log("data recibida: ", dataString);

    if (topic == "clase4") {
        io.sockets.emit("dataiotClase4", {
            mensaje: dataString
        });
    }
    if (topic == "clase5") {
        let dataJson = JSON.parse(dataString);
        let newTemp = dataJson.temperatura + 1;
        //console.log("temperatura: ", dataJson.temperatura);
        io.sockets.emit("dataiotClase5", {
            temperatura: newTemp,
            humedad: dataJson.humedad
        });
        grabarConPostgres(newTemp, dataJson.humedad, dataJson.device);
    }

});
//mongdb
/*
fecha
metadata
 */

function grabarConPostgres(temp, humedad, device) {
    let antes = new Date();
    poolPg.query('INSERT INTO public."sensorData" (time_stamp, device, temperatura, humedad) VALUES (now(),$1,$2,$3)',
        [device, temp, humedad],
        (err, res) => {
            if (err) throw err;
            let despues = new Date();
            let diferencia = despues.getTime() - antes.getTime();
            console.log(diferencia);
        });
}



