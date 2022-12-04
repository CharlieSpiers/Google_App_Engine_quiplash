var socket = null;

//Prepare game
var app = new Vue({
    el: '#game',
    data: {
        connected: false,
        logged_in: false,
        messages: [],
        chatmessage: '',
        prompt_text: '',
        answer_text: '',
        username: '',
        password: '',

        game_state: {
            joining: true,
            ended: false,
            round: 0,
            round_state: ''
        },
        player_state: {
            

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
            this.game_state = game_state;
            this.player_state = player_state;
            this.other_player_state = other_player_state;
        },

        register() { socket.emit('register', {username: this.username, password: this.password}); },

        login() { socket.emit('login', {username: this.username, password: this.password}); },

        submit_prompt() { socket.emit('submit_prompt', this.prompt_text); },

        submit_answer() { socket.emit('submit_answer', this.answer_text); },

        submit_vote(number) { socket.emit('vote', number); },

        next_page() { socket.emit('next'); },

        startGame() { socket.emit('start_game'); },
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
    });

    //Handle when set to admin
    socket.on('setAdmin', bool => app.admin = bool);

    //Handle incoming chat message
    socket.on('chat', msg => app.handleChat(message));

    //Handle getting an error message
    socket.on('error', msg => alert(msg));

    //Handle state updates
    socket.on('state', state_dict => app.update_state(state_dict))

}
