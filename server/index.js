//imports
const path = require('node:path'); 
const express = require('express');
const http = require('http');
const redis = require('redis');
const { Server } = require("socket.io");
const bodyParser = require('body-parser')
const cors = require('cors');
const jwt = require('jsonwebtoken');
const jwt_decode = require('jwt-decode');
const sqlite3 = require('sqlite3').verbose();
var LocalStorage = require('node-localstorage').LocalStorage
const Database = require('better-sqlite3');
require('dotenv').config();

//db setup
const db = new Database(path.resolve(__dirname, 'game.db'), { verbose: console.log })
db.pragma('journal_mode = WAL');

//dict setup
const dict = new Database(path.resolve(__dirname, 'Dictionary.db'), { verbose: console.log })
dict.pragma('journal_mode = WAL')

//var setup
const alphabet = [...Array(26)].map((_, i) => String.fromCharCode(i + 97));

//local storage
var sockets = new LocalStorage('./sockets');
sockets.clear()

//clear db
db.prepare("DELETE FROM Games").run() //clear records of Games
for (let row of db.prepare("SELECT name from sqlite_master where type='table'").all()){
  if(row.name !== 'Games'){
    db.prepare(`DROP TABLE ${row.name}`).run();
  }
}

//server setup
const app = express();
const server = http.createServer(app);
app.use(
  cors({
    origin: 'http://localhost:3000'
  }))
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: false }))
const io = new Server(server);

//helper
function getRandomLetter() {
  return alphabet[Math.floor(Math.random() * alphabet.length)]
}

const genRandomLetters = (len)=>{
  return [...Array(len)].map((_, i) => getRandomLetter());
}

const getToken = (payload)=>{
  return(jwt.sign(payload, process.env.TOKEN_SECRET))
}

const buildAnagramsPayload = (i, l, s, p, pw)=>{
  return({id: i, game_type: 'Anagrams', start_time: s, letters: l, player_number: p, password: pw})
}

const attemptDelete = (id)=>{
  if(db.prepare(`SELECT * FROM Games WHERE ID='${id}'`).get() === undefined){
    return
  }
  const inf = db.prepare(`SELECT COUNT(Active) as cnt FROM _${id} WHERE Active=1`).get()
  if(inf.cnt === 0){
    db.prepare(`DELETE FROM Games WHERE ID=${id};`).run()
    db.prepare(`DROP TABLE _${id}`).run();
  }
}

const sendPlayerInfos = (id)=>{
  if(db.prepare(`SELECT * FROM Games WHERE ID='${id}'`).get() === undefined){
    return
  }
  var player_infos = db.prepare(`SELECT PlayerNumber, PlayerName, Score FROM _${id}`).all()
  var sockets = db.prepare(`SELECT SocketID FROM _${id} WHERE Active = 1`).all()
  console.log(player_infos)
  console.log(sockets)
  sockets.forEach((e)=>{
    var socketById = io.sockets.sockets.get(e.SocketID)
    socketById.emit('updated players', JSON.stringify({players: player_infos}))
  })
}

const createNewGame = (game_type, password)=>{
  if(game_type !== 'Anagrams' && game_type !== 'Word Search'){return(null)}
  const row = db.prepare("SELECT MAX(ID) as id FROM Games").get()
  var id = row.id === null? 0 : row.id + 1
  if(id > 9999){
    return(null)
  }
  var data = null;
  switch(game_type){
    case 'Anagrams':
      data = JSON.stringify({letters: genRandomLetters(8), start_time: Math.floor(Date.now() / 1000)})
      db.prepare(`CREATE TABLE "_${id}"("PlayerNumber" INTEGER, "PlayerName" TEXT, "Words" TEXT, "Score" INTEGER, "Active" INTEGER, "SocketID" TEXT);`).run()
      break
    default:
      return
  }
  db.prepare(`INSERT INTO Games(ID, GameType, Password, Data) VALUES(${id}, '${game_type}', '${password}', '${data}')`).run()
  setTimeout(attemptDelete, 300000, id) //if nobody joins in 5 minutes delete
  return(id)
}

const joinAnagrams = (id, name, password)=>{
  var row = db.prepare(`SELECT MAX(PlayerNumber) as max_player_num FROM _${id}`).get()
  var next_player_num = row.max_player_num === null ? 0 : row.max_player_num + 1
  db.prepare(`INSERT INTO _${id}(PlayerNumber, PlayerName, Words, Score, Active) VALUES(${next_player_num}, '${name}', '${JSON.stringify({words: []})}', 0, 0)`,).run()
  //create token
  row = db.prepare(`SELECT data FROM Games WHERE ID=${id}`).get()
  const data = JSON.parse(row.Data)
  const payload = buildAnagramsPayload(id, data.letters, data.start_time, next_player_num, password)
  return(getToken(payload))
}

const joinGame = (id, password, name)=>{
  const row = db.prepare(`SELECT * FROM Games WHERE ID='${id}' AND Password='${password}'`).get(); 
  if(row === undefined){return(null)}
  const game_type = row.GameType
  switch(game_type){
    case 'Anagrams':
      return(joinAnagrams(id, name, password))
    default:
      return
  }
}

const validWord = (letters, cur_words, word)=>{
  if(word.length == 0){return(false)}
  if(cur_words.includes(word)){return(false)}
  const row = dict.prepare(`SELECT COUNT(word) as cnt FROM entries WHERE word='${word}'`).get()
  if(row.cnt === 0){return(false)}
  for(let i = 0; i < word.length; i++){
    var ind = letters.indexOf(word[i])
    if(ind === -1){return(false)}
    letters.splice(ind, 1)
  }
  return(true)
}

//connection helper
const validateToken = (info)=>{
  var row = db.prepare(`SELECT Password FROM Games WHERE ID='${info.id}' AND Password='${info.password}'`).get()
  if(row === undefined){
    return(false);
  }
  return(true);
}

//endpoints
app.post('/makegame', (req, res) => {
  if(typeof req.body.game_type !== "string"){return}
  const id = createNewGame(req.body.game_type, req.body.password)
  res.json({success: true, token: joinGame(id, req.body.password, req.body.name)});
})

app.post('/joingame', (req, res) => {
  var token = joinGame(req.body.id, req.body.password, req.body.name)
  if(token === null){
    res.json({success: false, token: null})
  }
  else{
    res.json({success: true, token: token})
  }
})

//websocket
io.on('connection', (socket) => {
  console.log('a user connected with socket id: ' + socket.id);
  socket.on('join game', (token)=>{
    console.log("initialzing")
    var info = jwt_decode(token)
    if(!validateToken(info)){
      socket.emit("join fail")
      return
    }
    db.prepare(`UPDATE _${info.id} SET Active = 1, SocketID='${socket.id}' WHERE PlayerNumber = ${info.player_number}`).run()
    sockets.setItem(socket.id, JSON.stringify({id: info.id, player_number: info.player_number}))
    sendPlayerInfos(info.id);
  })

  //anagrams connections
  socket.on('anagrams submit word', (token, word)=>{
    var info = jwt_decode(token)
    if(!validateToken(info)){
      socket.emit("join fail")
      return
    }
    var row = db.prepare(`SELECT * FROM Games WHERE ID='${info.id}'`).get()
    if(row === undefined || row.GameType !== 'Anagrams'){return}
    var letters = JSON.parse(row.Data).letters
    row = db.prepare(`SELECT Words FROM _${info.id} WHERE PlayerNumber=${info.player_number}`).get()
    var cur_words = JSON.parse(row.Words).words;
    if(!validWord(letters, cur_words, word)){
      //failed
      socket.emit('anagrams failed word')
      return
    }
    cur_words.push(word);
    db.prepare(`UPDATE _${info.id} SET Words = '${JSON.stringify({"words": cur_words})}' WHERE PlayerNumber=${info.player_number}`).run()
    row = db.prepare(`SELECT Score FROM _${info.id} WHERE PlayerNumber=${info.player_number}`).get()
    console.log(row)
    var new_score = row.Score + (word.length * 100)
    db.prepare(`UPDATE _${info.id} SET Score = ${new_score} WHERE PlayerNumber=${info.player_number}`).run()
    socket.emit('anagrams updated words', JSON.stringify({words: cur_words, score: new_score}))
    sendPlayerInfos(info.id);
  })
  socket.on('disconnect', ()=>{
    console.log('A user disconnected');
    var info = JSON.parse(sockets.getItem(socket.id));
    if(info === null){
      return
    }
    if(db.prepare(`SELECT * FROM Games WHERE ID = '${info.id}'`).get() !== undefined){
      db.prepare(`UPDATE _${info.id} SET Active = 0, SocketID='none' WHERE PlayerNumber = ${info.player_number}`).run()
    }
    sockets.removeItem(socket.id)
    attemptDelete(info.id)
  })
});

server.listen(3001, () => {
  console.log('listening on *:3001');
});