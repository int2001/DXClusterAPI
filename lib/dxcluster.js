/**
 * DX Cluster Connection Library
 * Shared library for managing DX Cluster telnet connections and parsing spot data
 * Used by both the clusters module and RBN module
 * 
 * @module lib/dxcluster
 */

const net = require('net')
const events = require('events')

module.exports = class DXCluster extends events.EventEmitter {
  constructor(opts = {}) {
    super()

    this.socket = opts.socket || null
    this.call = opts.call || null
    this.status = {
      connected: false,
      awaiting_login: false,
      awaiting_password: false,
    }
    this.regex = {
      deline: /^(DX de) +([A-Z0-9/\-#]{3,}):? *(\d*.\d{1,2}) *([A-Z0-9/\-#]{3,}) +(.*\S)? +(\d{4}){1}Z *(\w{2}\d{2})?/g,
      callsign: /(((\d|[A-Z])+\/){0,2}((\d|[A-Z]){3,})(\/(\d|[A-Z])+)?(\/(\d|[A-Z])+)?){1,1}/g,
      frequency: /[0-9]{1,8}\.[0-9]{1,3}/g,
      time: /[0-9]{4}Z/g
    }
    this.ct = opts.ct || '\n'
    this.dxId = opts.dxId || 'DX de'
  }

  connect(opts = {}) {
    return new Promise((resolve, reject) => {
      let call = opts.call || this.call
      if(!call) {
        reject('You must specify a callsign')
        return;
      }

      this.host = opts.host || '127.0.0.1'
      this.port = opts.port || 23

      this.socket = net.createConnection({
        host: this.host,
        port: this.port || 7300
      }, () => {
        this.status.connected = this.status.awaiting_login = true;
	if ((opts.password || '') !== '') { this.status.awaiting_password = true; }
        resolve(this.socket);
      })

      let loginPrompt = opts.loginPrompt || 'Please enter your call:';
      let passPrompt = opts.passPrompt || 'password:';

      this.socket.on('data', (data) => {
        if(this.status.awaiting_login) {
          if(data.toString('utf8').indexOf(loginPrompt) != -1) {
            if(this.write(call)) {
              this.status.awaiting_login = false
            }
          }
        }
        if(this.status.awaiting_password) {
          if(data.toString('utf8').indexOf(passPrompt) != -1) {
            if(this.write(opts.password)) {
              this.status.awaiting_password = false
            }
          }
        }
        this._parseDX(data.toString('utf8'))
      })

      this.socket.on('close', (err) => {
        this.status.connected = this.status.awaiting_login = false;
        this.emit('close');
      })

      this.socket.on('timeout', () => {
        this.emit('timeout')
      })
    })
  }

  close() {
    this.status.connected = this.status.awaiting_login = false;
    this.socket = this.socket.end()
    this.emit('closed')
  }

  destroy() {
    this.status.connected = this.status.awaiting_login = false;
    this.socket = this.socket.destroy()
    this.emit('destroyed')
  }

  write(str) {
    return this.socket.write(str + this.ct)
  }

  _parseDX(dxString) {
	  // Safety: Check if input is valid string
	  if (!dxString || typeof dxString !== 'string') {
		  return;
	  }
	  
	  // Safety: Limit string length to prevent memory issues
	  if (dxString.length > 1000) {
		  return;
	  }
	  
	  let dxSpot = { }
	  if(dxString.indexOf(this.dxId) == 0) {
		  let regex=new RegExp(this.regex.deline,'u');
		  let m;
		  if ((m = regex.exec(dxString)) !== null) {
			  let callsigns = [m[2],m[4]];
			  let frequency = parseFloat(m[3]);
			  
			  // Safety: Validate callsigns and frequency
			  if(callsigns.length < 2 || !callsigns[0] || !callsigns[1] || !frequency || isNaN(frequency)) {
				  this.emit('parseerror', dxString)
				  return;
			  }
			  
			  // Safety: Validate frequency range (30 kHz to 300 GHz)
			  if (frequency < 30 || frequency > 300000000) {
				  this.emit('parseerror', dxString)
				  return;
			  }
			  
			  // Safety: Sanitize message (remove control characters, limit length)
			  let message = m[5] || '';
			  message = message.replace(/[\x00-\x1F\x7F-\x9F]/g, '').substring(0, 200);
			  
			  dxSpot = {
				  spotter: callsigns[0].trim().substring(0, 20),
				  spotted: callsigns[1].trim().substring(0, 20),
				  frequency,
				  message: message.trim(),
				  when: new Date()
			  }
			  this.emit('spot', dxSpot)
		  }
	  } else {
		  this.emit('message', dxString)
	  }
  }
}
