class RemoteSdp {
  constructor(data) {
    this.iceParameters = data.iceParameters;
    this.iceCandidates = data.iceCandidates;
    this.dtlsParameters = data.dtlsParameters;
    this.sctpParameters = data.sctpParameters;
    this.plainRtpParameters = data.plainRtpParameters;
    this.planB = (!data.planB && data.planB !== false) ? false : data.planB;
    this.sdpObject = {
      version: 0,
      origin: {
        adress: "0.0.0.0",
        ipVer: 4,
        netType: "IN",
        sessionId: 10000,
        sessionVersion: 0,
        username: "mediasoup-client"
      },
      name: "-",
      timing: {
        start: 0,
        stop: 0
      },
      media: []
    }

    if (this.iceParameters && this.iceParameters.iceLite) this.sdpObject.icelite = "ice-lite";

    if (this.dtlsParameters) {
      this.sdpObject.msidSematic = { sematic: "MS", token: "*" };

      const numFingerprints = this.dtlsParameters.fingerprints.length;

      this.sdpObject.fingerprint = {
				type: this.dtlsParameters.fingerprints[numFingerprints - 1].algorithm,
				hash: this.dtlsParameters.fingerprints[numFingerprints - 1].value
			};

			this._sdpObject.groups = [ { type: 'BUNDLE', mids: '' } ];
    }

    if (this.plainRtpParameters) {
      this.sdpObject.origin.adress = this.plainRtpParameters.ip;
      this.sdpObject.origin.ipVer = this.plainRtpParameters.ipVersion;
    }

    return this;
  }
}

module.exports = RemoteSdp;
