const express = require("express");
const socketIO = require("socket.io");
const http = require("http");
const mqtt = require("mqtt");
const {Pool} = require('pg');
const {MongoClient} = require("mongodb");
const cassandra = require('cassandra-driver');
const rethinkdb = require('rethinkdb');
const {initializeApp, cert} = require('firebase-admin/app');
const {getDatabase, set} = require('firebase-admin/database');

const awsPublicIp = "34.204.7.4";

/******* postgres ******/
const poolPg = new Pool({
    host: awsPublicIp,
    user: "postgres",
    password: "mysecretpassword",
    port: 5432,
    database: "clase4"
});

poolPg.on("error", (err, client) => {
    console.error("error", err);
});

/****** mongo db *******/
const uri = "mongodb://" + awsPublicIp + ":27017/?maxPoolSize=20";
const clientMongoDb = new MongoClient(uri);

let mongodb = clientMongoDb.db("clase4");
let collectionSensorData = mongodb.collection("sensordata");
let collectionSensorDataTs = mongodb.collection("sensordatats");

/******* cassandra *******/
let authProvider = new cassandra.auth.PlainTextAuthProvider('cassandra', 'cassandra');
let clientCassandra = new cassandra.Client({
    contactPoints: ['localhost'],
    authProvider: authProvider,
    localDataCenter: 'datacenter1',
    keyspace: 'dataiot'
});

/******* rethink db *******/
let connRethinkDb = null;
rethinkdb.connect({
    host: "localhost",
    port: 49154,
    db: "dataiot"
}, function (err, conn) {
    if (err) throw err;
    console.log("conexión rethink exitosa");
    connRethinkDb = conn;
});

/********* firebase *********/
let serviceAccount = require("./clase5iot-firebase-adminsdk-laplh-bd7ab187ed.json");

initializeApp({
    credential: cert(serviceAccount),
    databaseURL: "https://clase5iot-default-rtdb.firebaseio.com"
});

let db = getDatabase();
let ref = db.ref('dataiot');

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
    host: awsPublicIp,
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
        grabarConMongoDb(newTemp, dataJson.humedad, dataJson.device);
        grabarConMongoDbTs(newTemp, dataJson.humedad, dataJson.device);
        grabarConCassandra(newTemp, dataJson.humedad, dataJson.device);
        grabarConRethinkDb(newTemp, dataJson.humedad, dataJson.device);
        grabarConFirebaseRtDb(newTemp, dataJson.humedad, dataJson.device);
    }

});

function grabarConFirebaseRtDb(temp, humedad, device) {
    let dataToBeSaved = {
        fecha: new Date(),
        device: device,
        temperatura: temp,
        humedad: humedad
    }

    ref.push().set(dataToBeSaved);
}

function grabarConRethinkDb(temp, humedad, device) {
    let dataToBeSaved = {
        device: device,
        temperatura: temp,
        humedad: humedad
    }
    rethinkdb.table('sensordata')
        .insert(dataToBeSaved)
        .run(connRethinkDb,function (err,res){
           if(err) throw err;
           console.log(JSON.stringify(res,null,2));
        });
}

function grabarConCassandra(temp, humedad, device) {
    let query = 'insert into sensor (id, fecha, humedad, temperatura, name) values (?,?,?,?,?)';
    let params = ['id2', new Date(), parseInt(humedad), parseInt(temp), device];
    let q1 = clientCassandra
        .execute(query, params)
        .then(function (res) {
            console.log("nuevo registro");
        })
        .catch(function (err) {
            console.error(err);
        });

}

function grabarConMongoDb(temp, humedad, device) {
    let dataToBeSaved = {
        device: device,
        temperatura: temp,
        humedad: humedad
    }

    clientMongoDb
        .connect()
        .then(async function (conn) {
            let res = await collectionSensorData.insertOne(dataToBeSaved);
            console.log(`un documento creado con id: ${res.insertedId}`);
        })
        .catch(function (err) {
            console.error("error", err);
        });
}

function grabarConMongoDbTs(temp, humedad, device) {
    let dataToBeSaved = {
        fecha: new Date(),
        metadata: {
            device: device
        },
        temperatura: temp,
        humedad: humedad
    }

    clientMongoDb
        .connect()
        .then(async function (conn) {
            let res = await collectionSensorDataTs.insertOne(dataToBeSaved);
            console.log(`un documento creado con id: ${res.insertedId}`);
        })
        .catch(function (err) {
            console.error("error", err);
        });
}

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



