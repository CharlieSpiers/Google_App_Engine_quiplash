var socket = null;

//Prepare game
var app = new Vue({
    el: '#game',
    data: {
        connected: false,
        logged_in: false,
        spectator: false,
        messages: [],
        chatmessage: '',
        prompt_text: '',
        answer_text: '',
        username: '',
        password: '',
        voted: false,
        prompts_answered: 0,

        game_state: {
            joining: true,
            ended: false,
            round: 0,
            round_state: '',
            voting: {
                info: {
                    '0': {},
                    '1': {}
                },
                prompt: ""
            }
        },
        player_state: {
            name: "name",
            score: 0,
            admin: false,
            prompts_to_make: 0,
            prompt_to_answer_0: "",
            prompt_to_answer_1: "",
        },
        other_player_state: {

        },
    },
    mounted: function() {
        connect(); 
    },
    methods: {
        handleChat(message) {
            if(this.messages.length + 1 > 10) {
                this.messages.pop();
            }
            this.messages.unshift(message);
        },

        chat() {
            socket.emit('chat',this.chatmessage);
            this.chatmessage = '';
        },

        update_state({game_state, player_state, other_player_state}) {
            if (this.game_state != game_state) this.voted = false;
            this.game_state = game_state;
            this.player_state = player_state;
            this.other_player_state = other_player_state;
        },

        register() { socket.emit('register', {username: this.username, password: this.password}); },

        login() { socket.emit('login', {username: this.username, password: this.password}); },

        submit_prompt() { 
            socket.emit('submit_prompt', {username: this.username, password: this.password, prompt_text: this.prompt_text}); 
            this.prompts_answered = 0;
        },

        submit_answer(prompt_num) { 
            let prompt = this.player_state.prompt_to_answer_1;
            if (prompt_num == 0) prompt = this.player_state.prompt_to_answer_0;
            alert(prompt);
            socket.emit('submit_answer', {username: this.username, prompt: prompt, answer_text: this.answer_text}); 
        },

        vote(number) { 
            socket.emit('vote', number); 
            this.voted = true;
        },

        next_page() { socket.emit('next'); },
    }
});

function connect() {
    //Prepare web socket
    socket = io();

    //Connect
    socket.on('connect', () => app.connected = true);

    //Handle connection error
    socket.on('connect_error', msg => alert('Unable to connect: ' + msg));

    //Handle disconnection
    socket.on('disconnect', function() {
        alert('Disconnected');
        app.connected = false;
        app.logged_in = false;
    });

    //Handle when set to admin
    socket.on('setAdmin', bool => app.admin = bool);

    //Handle incoming chat message
    socket.on('chat', msg => app.handleChat(msg));

    //Handle getting an error message
    socket.on('error', msg => alert(msg));

    //Handle state updates
    socket.on('state', state_dict => app.update_state(state_dict))

    //Handle responses from the servers
    socket.on('login', ({result, message}) => {
        if (!result) alert(message);
        else app.logged_in = true;
    });

    //Handle responses from the servers
    socket.on('spectator', () => app.spectator = true);

    socket.on('register', ({result, message}) => {
        if (!result) alert(message);
        else app.logged_in = true;
    });

    socket.on('submit_prompt', ({result, message}) => {
        if (!result) alert(message);
        else {
            app.player_state.prompts_to_make -= 1;
            app.prompt_text = "";
        }
    });
}
