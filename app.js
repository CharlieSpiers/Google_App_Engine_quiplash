'use strict';

//Set up express
const express = require('express');
const app = express();

//Setup socket.io
const server = require('http').Server(app);
const io = require('socket.io')(server);
require('dotenv').config();

//Setup static page handling
app.set('view engine', 'ejs');
app.use('/static', express.static('public'));

//Set up axios for connecting to the Azure backend
const axios = require('axios').create({ baseURL: process.env.AZURE_BASE_URL })
axios.defaults.headers.common['x-functions-key'] = process.env.AZURE_FUNCTION_KEY

//Game state variables
const round_states = {
  0: 'Prompts',
  1: 'Answers',
  2: 'Voting',
  3: 'Results',  
  4: 'Scores'
}
let players = new Map(); // socket : player_state 
let gamestate = {joining: true, ended: false, round: 0, round_state: round_states[0], }


//Handle client interface on /
app.get('/', (req, res) => {
  res.render('client');
});
//Handle display interface on /display
app.get('/display', (req, res) => {
  res.render('display');
});


//Start the server
function startServer() {
    const PORT = process.env.PORT || 8080;
    server.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
    });
}

//Start the game
function startGame(socket) {
  console.log("Starting game");
  //start the game
  //Update all
}

//Chat message
function handleChat(message) {
    console.log('Handling chat: ' + message); 
    for(const socket of players) {
      socket.emit('chat', message)
    }
}

function update_state(socket) {
  let scores = {}
  players.forEach(x => scores[x.name] = x.score);
  
  socket.emit('state', {
    game_state: gamestate,
    player_state: players.get(socket),
    other_player_state: scores
  });
}

function add_player(socket, name) {
  players.set(socket, {
    name: username,
    score: 0,
    admin: false
  });

  if (players.size === 1) {
    console.log('Setting admin to true');
    players.get(socket).admin = true;
  };
  update_state(socket);
}

function handle_request(socket, url, data, event_name, on_success, on_fail) {
  axios.post(url, data)
  .then(response => {
    let resp_data = response.response.data;
    if (resp_data.result) {
      on_success(socket, resp_data);
    } else {
      on_fail(socket, resp_data);
    }
    socket.emit(event_name, resp_data.result, resp_data.msg)
  })
  .catch(error => {
    console.log(error);
    socket.emit(event_name, false, 'An unexpected error occured')
  })
}

//Handle new connection
io.on('connection', socket => { 
  console.log('New connection');

  //Handle disconnection
  socket.on('disconnect', () => {
    console.log('Dropped connection');
  });

  //Handle on chat message received
  socket.on('chat', message => {
    const name = players.get(socket).get(name)
    handleChat(name + ": " + message);
  });

  //Handle register
  socket.on('register', ({username, password}) => {
    console.log('register: username=${username}, password=${password}')
    let data = {username: username, password: password}
    handle_request(socket, '/player/register', data, 'result', (soc, res) => {}, (soc, res) => {})
  });

  //Handle login
  socket.on('login', ({username, password}) => {
    console.log('login: username=${username}, password=${password}')
    let data = {username: username, password: password}
    handle_request(socket, '/player/login', data, 'login', (soc, res) => add_player(soc, res), (soc, res) => {})
  });

  //Handle submit prompt
  socket.on('submit_prompt', prompt_text => {
    // console.log('submit_prompt: username=${username}, password=${password}')
    // let data = {username: username, password: password}
    // handle_request(socket, '/player/login', data, 'login', res => add_player(res), () => {})
  });

  //Handle starting game
  socket.on('start_game', () => {
    if (players.get(socket).get(admin)) {
      startGame(socket);
    } else {
      socket.emit('error', 'You are not the admin!')
    }
  });

});

//Start server
if (module === require.main) {
  startServer();
}

module.exports = server;
