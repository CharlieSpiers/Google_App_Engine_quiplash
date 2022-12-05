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
  PROMPTS: 'Prompts',
  ANSWERS: 'Answers',
  VOTING: 'Voting',
  RESULTS: 'Results',  
  SCORES: 'Scores'
}
let players = new Map(); // socket : {spectator, admin, name, score}
let game_state = {joining: true, ended: false, round: 0, round_state: round_states.PROMPTS, }
let game_prompts = {} // user : prompt
let game_answers = {} // prompt : {user1: ans, user2: ans}

//Handle client interface on /
app.get('/', (req, res) => {
  res.render('client');
});
//Handle display interface on /display
app.get('/display', (req, res) => {
  res.render('display');
});


//Start the server
function start_server() {
    const PORT = process.env.PORT || 8080;
    server.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
    });
}


//Start the game
function progress_game() {
  console.log("Progressing game");
  
  if (game_state.joining) {
    game_state.joining = false;
  } else {
    switch (game_state.round_state) {
      case round_states.PROMPTS:
        // Collect user's prompts from this round into game_prompts (user : prompt)
        // Decide which users to give which prompts
        // Change game state to ANSWERS
        // Update state for all players
        // Send out prompts for answering (may send 2 each if odd players)
        break;
      
      case round_states.ANSWERS:
        // Collect answers from this round into user_answers (prompt : {user: answer, user2: answer2})
        // May the voting begin
        break;
        
      case round_states.VOTING:
        // Select random prompt from unvoted prompts:
        // If the user was not an answerer give them a vote else tell em to sit their bitch ass down
        // Collect votes in a map (prompt : (user: vote_num, user2: votenum))
        break;
          
      case round_states.RESULTS:
        // Show the result for this round of voting
        // If there are still prompts left to be voted on, go back to voting
        // Else go to scores (for the round)
        break;

      case round_states.SCORES:
        if (game_state.round == 3) {
          game_state.ended = true;
        } else {
          game_state.round += 1;
          game_state.round_state = round_states.PROMPTS;
        }
        break;
    }
  }
  //Update all client states
}


//Chat message
function handle_chat(message) {
    console.log('Handling chat: ' + message); 
    for(const socket of players) {
      socket.emit('chat', message)
    }
}


function update_state(socket) {
  let scores = {}
  players.forEach(x => scores[x.name] = x.score);
  
  socket.emit('state', {
    game_state: game_state,
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


function handle_request(socket, url, data, event_name, on_success) {
  axios.post(url, data)
  .then(response => {
    let resp_data = response.response.data;
    if (resp_data.result) {
      on_success(socket, resp_data);
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
    handle_chat(name + ": " + message);
  });

  //Handle register
  socket.on('register', ({username, password}) => {
    console.log('register: username=${username}, password=${password}')
    let data = {username: username, password: password}
    handle_request(socket, '/player/register', data, 'result', (_, _) => {})
  });

  //Handle login
  socket.on('login', ({username, password}) => {
    console.log('login: username=${username}, password=${password}')
    let data = {username: username, password: password}
    handle_request(socket, '/player/login', data, 'login', (soc, res) => add_player(soc, res))
  });

  //Handle submit prompt
  socket.on('submit_prompt', ({username, password, prompt_text}) => {
    console.log('submit_prompt: username=${username}, text=${prompt_text}')
    let data = {username: username, password: password, text: prompt_text}
    handle_request(socket, '/prompt/create', data, 'submit_prompt', (soc, res) => add_prompt(soc, res))
  });

  //Handle progressing the game
  socket.on('next', () => {
    if (players.get(socket).get(admin)) {
      progress_game(socket);
    } else {
      socket.emit('next', false, 'You are not the admin!')
    }
  });

});

//Start server
if (module === require.main) {
  start_server();
}

module.exports = server;
