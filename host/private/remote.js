let socket = null;
let connected = false;
/**
 * @type {MediaStream}
 */
let stream = null;
let peerConnection = null;
let restarting = false;

let config = {};

function initSocket() {
    restarting = false;

    socket = new WebSocket('https://%hostIP%:%webCommsPort%');

    socket.addEventListener('open', e => {
        connected = true;

        socket.send(JSON.stringify({
            type: 'ready'
        }));
    });

    socket.addEventListener('close', e => {
        connected = false;
        if (restarting) {return}
        setTimeout(() => {initSocket()}, 10000);
    });

    socket.addEventListener('error', e => {
        connected = false;
        if (restarting) {return}
        setTimeout(() => {initSocket()}, 10000);
    });

    socket.addEventListener('message', msg => {
        const data = JSON.parse(msg.data);
        console.log(data)

        switch (data.type) {
            case 'answer':
                if (peerConnection !== null) {
                    peerConnection.setRemoteDescription(data.message);
                }
                break;
            case 'candidate':
                if (peerConnection !== null) {
                    peerConnection.addIceCandidate(new RTCIceCandidate(data.message));
                }
                break;
            case 'ready':
                if (stream !== null) {
                    setupWebRTC(data.message);
                }
                config = data.config;
                break;
            case 'ping':
                if (stream !== null) {
                    socket.send('{"type": "ping"}');
                }
                break;
            default:
                console.log(msg);
        }
    });
}

function setupWebRTC(config) {
    peerConnection = new RTCPeerConnection(config);

    if (stream !== null) {
        const tracks = stream.getTracks();

        for (let i = 0; i < tracks.length; i++) {
            peerConnection.addTrack(tracks[i], stream);
        }
    }

    peerConnection.addEventListener('icecandidate', e => {
        if (!e.candidate) {return}

        socket.send(JSON.stringify({
            type: 'candidate',
            message: e.candidate,
        }));
    });

    peerConnection.createOffer().then(offer => {
        peerConnection.setLocalDescription(offer);
        socket.send(JSON.stringify({
            type: 'offer',
            message: offer
        }));
    }).catch(error => {
        console.error('Issue creating offer: ', error);
    });
}

function checkNumber(n, min, max, def) {
    n = parseInt(n);
    if (isNaN(n)) {
        return def;
    }
    return Math.min(Math.max(n, min), max);
}

async function run() {
    stream = await navigator.mediaDevices.getDisplayMedia({
        audio: {
            echoCancellation: false
        },
        video: {
            displaySurface: 'monitor',
            frameRate: checkNumber(document.querySelector('#fps').value, 1, parseInt(document.querySelector('#maxFps').value), parseInt(document.querySelector('#defaultFps').value))
        }
    });

    try {
        initSocket();
    } catch (err) {}
}