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
const axios = require('axios').create({ baseURL: process.env.AZURE_BASE_URL });
axios.defaults.headers.common['x-functions-key'] = process.env.AZURE_FUNCTION_KEY;

//Game state variables
const round_states = {
  PROMPTS: 'Prompts',
  ANSWERS: 'Answers',
  VOTING: 'Voting',
  RESULTS: 'Results',  
  SCORES: 'Scores'
};
let players = new Map(); // socket : {admin, name, score}
let spectators = {}; // socket : name
let game_state = {joining: true, ended: false, round: 0, round_state: round_states.PROMPTS, };
let game_prompts = {}; // name : prompt
let player_prompts = {}; // prompt : name, name
let game_answers = {}; // name : {answer, (name, prompt)}

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
  if (game_state.ended) {
    game_state = {joining: true, ended: false, round: 0, round_state: round_states.PROMPTS, };
    game_prompts = {};
    player_prompts = {};
    game_answers = {};
    update_state();
  } else if (game_state.joining) {
    game_state.joining = false;
    players.forEach(p => {
      game_prompts[p.name] = ["", ""]
      if (players.size()%2 == 0) p.prompts_to_make = 1;
      else  p.prompts_to_make = 2; 
    })
    update_state();
  } else {
    switch (game_state.round_state) {
      case round_states.PROMPTS:
        // Collect user's prompts from this round into game_prompts (user : prompt)
        // Decide which users to give which prompts
        // Change game state to ANSWERS
        // Update state for all players
        // Send out prompts for answering (may send 2 each if odd players)
        prompts_needed = players.size();
        player_prompt_num = 1;
        if (prompts_needed % 2 == 0) {
          prompts_needed = prompts_needed/2;
          player_prompt_num = 2;
        }
        prompts_to_give = {}
        players.forEach(value => prompts_to_give[value.name] = player_prompt_num)

        game_prompts.sort((_, __) => 0.5 - Math.random())
        round_prompts = Object.values(game_prompts).slice(0, (prompts_needed/2 | 0)+1);
        axios.post("/prompts/get", {"prompts" : (prompts_needed/2 | 0)}) //floor of prompts/2
        .then(response => response.data.forEach(x => round_prompts.push(x.text)))
        .catch(error => console.log(error))

        names = Array.from(players.keys());
        names.sort((_, __) => 0.5 - Math.random());
        names = [...names, ...names];

        round_prompts.forEach((prompt, index) => {
          name1 = names[2*index]
          name2 = names[(2*index)+1]

          player_prompts[prompt] = {
              0: name1,
              1: name2
          }

          players.forEach(p => {
            if (p.name == name1 || p.name == name2) {
              p.prompts_to_answer.push(prompt);
            }
          })
        });

        game_state.round_state = round_states.ANSWERS
        update_state()
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
  update_state();
}


//Chat message
function handle_chat(message) {
    console.log('Handling chat: ' + message); 
    for(const [socket, _] of players.entries()) {
      socket.emit('chat', message);
    }
}


function update_state() {
  let scores = {};
  players.forEach(x => scores[x.name] = x.score);
  
  for(const [socket, _] of players.entries()) {
    socket.emit('state', {
      game_state: game_state,
      player_state: players.get(socket),
      other_player_state: scores
    });
  }
  spectators.forEach(socket => {
    socket.emit('state', {
      game_state: game_state,
      other_player_state: scores
    });
  });
}


function add_player(socket, name) {
  if (!game_state.joining) {
    spectators[socket] = name;
  } else {
    players.set(socket, {
      name: name,
      score: 0,
      admin: (players.size == 1),
      prompts_to_make: 0,
      prompts_to_answer: []
    });
  }
  update_state();
}

function add_prompt(player_name, prompt_text) {
  game_prompts[player_name] = prompt_text;
}

function add_answer(player_name, answer_text) {
  let skip = false;
  Object.keys(player_prompts).forEach(key => {
    if (skip) return;
    name1 = player_prompts[key][0][username];
    name2 = player_prompts[key][1][username];
    if (player_name != name1 && player_name != name2) return;

    prompt_maker = "";
    if (player_name == name1 && player_prompts[key][0][text] == "") {
      prompt_maker = name1;
    } else if (player_name == name2 && player_prompts[key][1][text] == "") {
      prompt_maker = name2;
    }
    if (prompt_maker == "") return;

    skip = true;
    game_answers[player_name] = {
      answer: answer_text,
      name: prompt_maker,
      prompt: key
    };
  });
}


function handle_request(socket, url, data, event_name, on_success) {
  axios.post(url, data)
  .then(response => {
    let {result, msg} = response.data;
    if (result) {
      on_success(socket);
    }
    console.log(msg);
    socket.emit(event_name, {result: result, message: msg});
  })
  .catch(error => {
    console.log(error);
    socket.emit(event_name, false, 'An unexpected error occured');
  })
}

//Handle new connection
io.on('connection', socket => { 
  console.log('New connection');

  //Handle disconnection
  socket.on('disconnect', () => {
    console.log('Dropped connection');
    if (players.has(socket)) {
      let new_admin = false;
      if (players.get(socket).admin && players.size != 1) new_admin = true;
      players.delete(socket);
      if (new_admin) {
        let {name, score, admin} = players[0];
        admin = true
      }
    }
    update_state();
  });

  //Handle on chat message received
  socket.on('chat', message => {
    if (! players.has(socket)) socket.emit('error', "not logged in");
    else {
      let {name, score, admin} = players.get(socket);
      handle_chat(name + ": " + message);
    }    
  });

  //Handle register
  socket.on('register', ({username, password}) => {
    console.log('register: username=' + username + ', password=' + password);
    let data = {username: username, password: password}
    handle_request(socket, '/player/register', data, 'register', (soc) => add_player(soc, username));
  });

  //Handle login
  socket.on('login', ({username, password}) => {
    console.log('login: username=' + username + ', password=' + password);
    let data = {username: username, password: password};
    handle_request(socket, '/player/login', data, 'login', (soc) => add_player(soc, username));
  });

  //Handle submit prompt
  socket.on('submit_prompt', ({username, password, prompt_text}) => {
    console.log('submit_prompt: username=' + username + ', password=' + password);
    let data = {username: username, password: password, text: prompt_text}
    handle_request(socket, '/prompt/create', data, 'submit_prompt', (_) => add_prompt(username, prompt_text));
  });

    //Handle submit answer
    socket.on('submit_answer', ({username, answer_text}) => {
      console.log('submit_answer: username=' + username);
      add_answer(username, answer_text);
    });

    //Handle submit vote
    socket.on('vote', vote => {
      //Once a vote is cast, advance the player state
      //If all votes are cast, advance to the next prompt and answers

      //Set round scores (but do not yet update total scores) for players to be round_number * votes * 100
      //Advance to the next prompt to vote on answers if any remain in this round
      //Advance to scoring if no more prompts
    });

  //Handle progressing the game
  socket.on('next', () => {
    if (!players.has(socket)) socket.emit('error', "not logged in");
    else if (players.get(socket).get(admin)) progress_game(socket);
    else socket.emit('next', false, 'You are not the admin!');
  });

});

//Start server
if (module === require.main) {
  start_server();
}

module.exports = server;
