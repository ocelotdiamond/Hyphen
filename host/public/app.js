const player = document.querySelector('video');
const controlsContainer = document.querySelector('.controls');
/**
 * @type {WebSocket|null}
 */
let socket = null;

let token = '';

window.addEventListener('error', error => {
    alert(`Error Line ${error.lineno}: ${error.message}`);
});

/**
 * @type {RTCPeerConnection}
 */
let remoteConnection = null;

/**
 * @type {MediaStream}
 */
let remoteStream = null;

let retryingConnection = false;

if (localStorage.getItem('address')) {
    document.querySelector('input.address').value = localStorage.getItem('address');
}

if (localStorage.getItem('username')) {
    document.querySelector('input.username').value = localStorage.getItem('username');
}

async function setup() {
    window.addEventListener('beforeunload', e => {
        e.returnValue = 'hyphen';
        e.preventDefault();
        return false;
    });
    const startButton = document.querySelector('button.connect');

    startButton.onclick = () => {};
    startButton.classList.add('disabled');

    retryingConnection = false;

    player.muted = false;

    player.addEventListener('resize', e => {
        player.width = player.videoWidth;
        player.height = player.videoHeight;
    });

    const address = document.querySelector('input.address').value;
    const username = document.querySelector('input.username').value;
    const password = document.querySelector('input.password').value;

    localStorage.setItem('address', address);
    localStorage.setItem('username', username);

    socket = new WebSocket('wss://' + address);

    socket.addEventListener('message', message => {
        const data = JSON.parse(message.data);

        switch (data.type) {
            case 'candidate':
                remoteConnection.addIceCandidate(new RTCIceCandidate(data.message));
                break;
            case 'offer':
                handleCallOffer(data);
                break;
            case 'ready':
                onReady(data.message);
                enableController();
                break;
            case 'token':
                token = data.message;
                localStorage.setItem('token', token);
                localStorage.setItem('tokenTime', Date.now());
                if (readyConfig !== null) {
                    readyConfig.auth = {
                        token: token
                    };
                    socket.send(JSON.stringify(readyConfig));
                }
                break;
            case 'status':
                document.querySelector('span.status').innerHTML = data.message;
                if (data.message === 'Incorrect Login Details') {
                    const startButton = document.querySelector('button.connect');

                    startButton.onclick = () => setup();
                    startButton.classList.remove('disabled');
                }
                break;
            default:
                break;
        }
    });

    socket.addEventListener('open', e => {
        const message = {
            type: 'start',
            message: {
                fps: 60,
                width: window.innerWidth,
                height: window.innerHeight
            },
            auth: {
                username: username,
                password: password
            }
        };

        if (password === '' && localStorage.getItem('token') && Date.now() - parseInt(localStorage.getItem('tokenTime')) <= 86400000) { // Less than a day later
            message.auth = {
                token: localStorage.getItem('token')
            }
        }

        socket.send(JSON.stringify(message));
    });

    socket.addEventListener('close', () => {
        if (retryingConnection) {return}
        retryingConnection = true;
        console.log('Socket connection lost, retrying!');
        // setTimeout(() => setup(), 2000);
    });

    socket.addEventListener('error', () => {
        if (retryingConnection || (socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING)) {return}
        retryingConnection = true;
        console.log('Socket connection lost, retrying!');
        // setTimeout(() => setup(), 2000);
    });
}

function getRelativePos(x, y) {
    const rect = player.getBoundingClientRect();
    return [x - rect.left, y - rect.top];
}

function enableController() {
    player.addEventListener('mousemove', e => {
        if (token.length === 0) {return}
        const [x, y] = getRelativePos(e.clientX, e.clientY);
        socket.send(`{"type": "mousemove", "message": { "x": ${x}, "y": ${y} }, "auth": { "token": "${token}" }}`);
        e.preventDefault();
        return false;
    });

    player.addEventListener('mousedown', e => {
        if (token.length === 0) {return}
        const [x, y] = getRelativePos(e.clientX, e.clientY);
        socket.send(`{"type": "mouse", "message": { "x": ${x}, "y": ${y}, "button": ${e.button}, "mouseDown": true }, "auth": { "token": "${token}" }}`);
        e.preventDefault();
        return false;
    });

    player.addEventListener('mouseup', e => {
        if (token.length === 0) {return}
        const [x, y] = getRelativePos(e.clientX, e.clientY);
        socket.send(`{"type": "mouse", "message": { "x": ${x}, "y": ${y}, "button": ${e.button}, "mouseDown": false }, "auth": { "token": "${token}" }}`);
        e.preventDefault();
        return false;
    });

    player.addEventListener('contextmenu', e => {
        if (token.length === 0) {return}
        const [x, y] = getRelativePos(e.clientX, e.clientY);
        socket.send(`{"type": "mouse", "message": { "x": ${x}, "y": ${y}, "button": ${e.button}, "mouseDown": false }, "auth": { "token": "${token}" }}`);
        e.preventDefault();
        return false;
    });

    player.addEventListener('wheel', e => {
        if (token.length === 0) {return}
        const [x, y] = getRelativePos(e.clientX, e.clientY);
        socket.send(`{"type": "wheel", "message": { "x": ${x}, "y": ${y}, "dx": ${e.deltaX}, "dy": ${e.deltaY} }, "auth": { "token": "${token}" }}`);
        e.preventDefault();
        return false;
    });

    window.addEventListener('keydown', e => {
        if (e.repeat || token.length === 0) {return}
        socket.send(`{"type": "keyboard", "message": { "code": "${e.key.toLowerCase().replace('\\', '\\\\').replace('"', '\\"')}", "down": true }, "auth": { "token": "${token}" }}`);
        e.preventDefault();
        return false;
    });

    window.addEventListener('keyup', e => {
        if (e.repeat || token.length === 0) {return}
        socket.send(`{"type": "keyboard", "message": { "code": "${e.key.toLowerCase().replace('\\', '\\\\').replace('"', '\\"')}", "down": false }, "auth": { "token": "${token}" }}`);
        e.preventDefault();
        return false;
    });
}

let readyConfig = null;

async function onReady(config) {
    if (remoteConnection) {
        remoteConnection.close();
    }

    remoteConnection = new RTCPeerConnection(config);

    remoteConnection.addEventListener('connectionstatechange', e => {
        const connectionState = remoteConnection.connectionState;
        if (!retryingConnection && (connectionState === 'disconnected' || connectionState === 'closed' || connectionState === 'failed')) {
            retryingConnection = true;
            if (socket !== null) {
                socket.close();
            }
            console.log('RTC connection lost, retrying!');
            setTimeout(() => setup(), 5000);
        }
    });

    remoteConnection.addEventListener('track', e => {
        remoteStream = new MediaStream(remoteConnection.getReceivers().map(receiver => receiver.track));
        player.srcObject = remoteStream;
        remoteStream.addEventListener('addtrack', e => {
            const videoTrackSettings = remoteStream.getVideoTracks()[0].getSettings();
            player.height = videoTrackSettings.height;
            player.width = videoTrackSettings.width;
        });
        remoteConnection.getReceivers().forEach(e => e.jitterBufferTarget = 0);
    });

    let stun = false;
    let turn = false;

    remoteConnection.addEventListener('icecandidate', e => {
        if (e.candidate) {
            if (e.candidate.type == 'srflx' || e.candidate.candidate.includes('srflx')) {
                stun = true;
            } else if (e.candidate.type == 'relay' || e.candidate.candidate.includes('relay')) {
                turn = true;
            }

            if (stun && turn) {
                player.style.display = 'block';
                controlsContainer.style.display = 'none';

                document.querySelectorAll('span').forEach(e => e.style.display = 'none');
            }

            if (token.length === 0) {return}

            socket.send(JSON.stringify({
                type: 'candidate',
                message: e.candidate,
                auth: {
                    token: token
                }
            }));
        }
    });

    if (token.length === 0) {
        readyConfig = {
            type: 'ready',
            message: config
        };
        return;
    }

    socket.send(JSON.stringify({
        type: 'ready',
        message: config,
        auth: {
            token: token
        }
    }));
}

async function handleCallOffer(data) {
    remoteConnection.setRemoteDescription(data.message);

    const answer = await remoteConnection.createAnswer();
    remoteConnection.setLocalDescription(answer);

    if (token.length === 0) {return}

    socket.send(JSON.stringify({
        type: 'answer',
        message: answer,
        auth: {
            token: token
        }
    }));
}