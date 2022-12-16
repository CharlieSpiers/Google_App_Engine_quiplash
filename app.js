'use strict';

const { info } = require('console');
//Set up express
const express = require('express');
const { json } = require('stream/consumers');
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
let spectators = new Map(); // socket : name
let game_state = {joining: true, ended: false, round: 1, round_state: round_states.PROMPTS, voting: {}, results: {}};
let submitted_prompts = {}; // name : prompt
let player_prompts = {}; // prompt : [{name, answer, votes}]
let passwords = {} // username : password


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
  if (game_state.ended) {
    game_state = {joining: true, ended: false, round: 1, round_state: round_states.PROMPTS, voting: {}, results: {}};
    submitted_prompts = {};
    player_prompts = {};
  } else if (game_state.joining) {
    game_state.joining = false;
    players.forEach(p => {
      submitted_prompts[p.name] = ["", ""]
      if (players.size%2 == 0) p.prompts_to_make = 1;
      else  p.prompts_to_make = 2; 
    })
  } else {
    switch (game_state.round_state) {
      case round_states.PROMPTS:
        let prompts_needed = players.size;
        let player_prompt_num = 1;
        if (prompts_needed % 2 == 0) {
          prompts_needed = prompts_needed/2;
          player_prompt_num = 2;
        }
        let prompts_to_give = {}
        players.forEach(value => prompts_to_give[value.name] = player_prompt_num)

        let sub_prom = []
        Object.values(submitted_prompts).forEach(x => {
          sub_prom.push(x[0]);
          if (players.size%2 == 1) sub_prom.push(x[1]);
        });
        sub_prom.sort((_, __) => 0.5 - Math.random());
        
        let round_prompts = []
        axios.post("/prompts/get", {"prompts" : (prompts_needed/2 | 0)}) //floor of prompts/2
        .then(response => response.data.forEach(x => round_prompts.push(x.text)))
        .catch(error => console.log(error))
        round_prompts.push(...sub_prom.slice(0, prompts_needed-round_prompts.length))

        let names = [];
        players.forEach(x => {
          names.push(x.name);
        });
        
        names.sort((_, __) => 0.5 - Math.random());
        names = [...names, ...names];

        round_prompts.forEach((prompt, index) => {
          let name1 = names[(2*index)];
          let name2 = names[(2*index)+1];
        
          while (prompt in player_prompts) {
            prompt += " "; //Avoid repeated prompts messing stuff up
          }

          player_prompts[prompt] = {vtd: false};
          player_prompts[prompt]['0'] = {name: name1, answer: "", votes: 0};
          player_prompts[prompt]['1'] = {name: name2, answer: "", votes: 0};

          players.forEach(p => {
            if (p.name == name1 || p.name == name2) {
              if (p.prompt_to_answer_0 == "") {
                p.prompt_to_answer_0 = prompt;
                p.prompts_to_answer = 1;
              } else {
                p.prompt_to_answer_1 = prompt;
                p.prompts_to_answer = 2;
              }
            }
          })
        });
        game_state.round_state = round_states.ANSWERS;
        game_state.results = {};
        for (const [_, player_dict] of players) {
          game_state.results[player_dict.name] = 0;
        };
        break;
      
      case round_states.ANSWERS:
        // Collect answers from this round into user_answers (prompt : {user: {answer, votes}, user2: {answer2, votes}})
        set_voting_state();
        game_state.round_state = round_states.VOTING;
        break;
        
      case round_states.VOTING:
        game_state.round_state = round_states.RESULTS;
        let p1res = (game_state.voting.info[0].votes * 100 * game_state.round);
        let p2res = (game_state.voting.info[1].votes * 100 * game_state.round)
        game_state.voting['scores'] = {
          '0': p1res,
          '1': p2res
        }
        game_state.results[game_state.voting.info[0].name] += p1res;
        game_state.results[game_state.voting.info[1].name] += p2res;
        break;
          
      case round_states.RESULTS:
        if (!set_voting_state()) game_state.round_state = round_states.VOTING;
        else {
          game_state.round_state = round_states.SCORES;
        }
        break;

      case round_states.SCORES:
        for (const [_, player_dict] of players) {
          update_player_scores();
          player_dict.score += game_state.results[player_dict.name];
        };

        if (game_state.round == 3) {
          update_player_games();
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

function update_player_scores() {
  for (let [name, more_score] of Object.entries(game_state.results)) {
    console.log("adding " + more_score + " score to " + name)
    let data = {username: name, password: passwords[name], add_to_score: more_score};
    axios.post('/player/update', data)
    .then(response => {
      let {result, msg} = response.data;
      if (!result) console.log("Something went wrong updating scores: " + msg);
    })
    .catch(error => {
      console.log(error.message);
    })
  }
}

function update_player_games() {
  for (let [name, more_score] of Object.entries(game_state.results)) {
    let data = {username: name, password: passwords[name], add_to_games_played: 1};
    axios.post('/player/update', data)
    .then(response => {
      let {result, msg} = response.data;
      if (!result) console.log("Something went wrong updating scores: " + msg);
    })
    .catch(error => {
      console.log(error.message);
    })
  }
}

//Returns a bool (if true advance to scores)
function set_voting_state() {
  console.log("Setting voting state");
  console.log(JSON.stringify(player_prompts));
  let skip = false;
  Object.keys(player_prompts).forEach(prompt => {
    if (player_prompts[prompt].vtd || skip) return;

    let info = {};
    Object.keys(player_prompts[prompt]).forEach(x => {
      if (x != "vtd") {
        info[x] = player_prompts[prompt][x];
      }
    })

    game_state['voting'] = {
      prompt: prompt,
      info: info
    }

    skip = true;
    player_prompts[prompt].vtd = true;
  });
  return !skip;
}

//Chat message
function handle_chat(message) {
    for(const [socket, _] of players.entries()) {
      socket.emit('chat', message);
    }
}


function update_state() {
  let scores = {};
  players.forEach(x => scores[x.name] = x.score);
  for(const [socket, _] of players.entries()) {
    console.log("Playaa state: " + JSON.stringify(players.get(socket)))
    socket.emit('state', {
      game_state: game_state,
      player_state: players.get(socket),
      other_player_state: scores
    });
  }
  for(const [socket, _] of spectators.entries()) {
    socket.emit('state', {
      game_state: game_state,
      other_player_state: scores
    });
  };
}


function add_player(socket, name, password) {
  if (!game_state.joining) {
    console.log("spectator")
    spectators.set(socket, name);
    socket.emit('spectator');
  } else {
    passwords[name] = password;
    players.set(socket, {
      name: name,
      score: 0,
      admin: (players.size == 0),
      prompts_to_make: 0,
      prompts_to_answer: 0,
      prompt_to_answer_0: "",
      prompt_to_answer_1: ""
    });
  }
  update_state();
}

function add_prompt(player_name, prompt_text) {
  if (submitted_prompts[player_name][0] == "") {
    submitted_prompts[player_name][0] = prompt_text;
  } else {
    submitted_prompts[player_name][1] = prompt_text;
  }
}

function handle_request(socket, url, data, event_name, on_success) {
  axios.post(url, data)
  .then(response => {
    let {result, msg} = response.data;
    if (result) {
      on_success(socket);
    }
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
    if (!players.has(socket)) socket.emit('error', "not logged in");
    else {
      let {name, score, admin} = players.get(socket);
      handle_chat(name + ": " + message);
    }    
  });

  //Handle register
  socket.on('register', ({username, password}) => {
    console.log('register: username=' + username + ', password=' + password);
    let data = {username: username, password: password}
    handle_request(socket, '/player/register', data, 'register', (soc) => add_player(soc, username, password));
  });

  //Handle login
  socket.on('login', ({username, password}) => {
    console.log('login: username=' + username + ', password=' + password);
    let data = {username: username, password: password};
    handle_request(socket, '/player/login', data, 'login', (soc) => add_player(soc, username, password));
  });

  //Handle submit prompt
  socket.on('submit_prompt', ({username, password, prompt_text}) => {
    console.log('submit_prompt: username=' + username + ', password=' + password);
    let data = {username: username, password: password, text: prompt_text}
    handle_request(socket, '/prompt/create', data, 'submit_prompt', (_) => add_prompt(username, prompt_text));
  });

  //Handle submit answer
  socket.on('submit_answer', ({username, prompt, answer_text}) => {
    console.log('submit_answer: username=' + username);
    prompt = player_prompts[prompt];
    if (prompt[0].name == username) {
      prompt[0].answer = answer_text;
    } else if (prompt[1].name == username) {
      prompt[1].answer = answer_text;
    }
  });

  //Handle submit vote
  socket.on('vote', number => {
    let curr_prompt = game_state['voting'].prompt;
    player_prompts[curr_prompt][number].votes += 1;
  });

  //Handle progressing the game
  socket.on('next', () => {
    console.log('next pressed');
    if (!players.has(socket)) socket.emit('error', "not logged in");
    else if (players.get(socket).admin) progress_game(socket);
    else socket.emit('next', false, 'You are not the admin!');
  });

});

//Start server
if (module === require.main) {
  start_server();
}

module.exports = server;


// function add_answer(player_name, prompt, answer_text) {
    
//   Object.keys(player_prompts).forEach(key => {
//     if (skip) return;
//     name1 = player_prompts[key][0][username];
//     name2 = player_prompts[key][1][username];
//     if (player_name != name1 && player_name != name2) return;

//     prompt_maker = "";
//     if (player_name == name1 && player_prompts[key][0][text] == "") {
//       prompt_maker = name1;
//     } else if (player_name == name2 && player_prompts[key][1][text] == "") {
//       prompt_maker = name2;
//     }
//     if (prompt_maker == "") return;

//     skip = true;
//     game_answers[player_name] = {
//       answer: answer_text,
//       name: prompt_maker,
//       prompt: key
//     };
//   });
// }