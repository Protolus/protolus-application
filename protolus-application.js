//todo: events support
var ext = require('prime-ext');
var prime = ext(require('prime'));
var Class = require('Classy');
var type = require('prime/util/type');
var string = require('prime/es5/string');
var array = ext(require('prime/es5/array'));
var fn = require('prime/es5/function');
var regexp = require('prime/es5/regexp');
var Emitter = require('prime/util/emitter');
var fs = require('fs');
var EnhancedEmitter = require('prime-ext/emitter-ext');
var InternalWorker = require('prime-ext/internal-worker');
var Configurable = require('prime-ext/configurable');
var Options = require('prime-ext/options');
var qs = require('querystring');
var uuid = require('node-uuid');
var Cookies = require('cookies');

var Application = {
    name : 'protolus_application',
    sessionDirectory : '/tmp', //location for file based sessions
    saveSession : function(key, data, callback){
        fs.exists(Application.sessionDirectory+'/'+Application.name+'/', function(exists){
            var doSave = function(){
                fs.writeFile(Application.sessionDirectory+'/'+Application.name+'/'+key+'.json', 
                    JSON.stringify(data), 'utf8', 
                    function(err){
                        if(err) console.log('ERROR', err);
                        if(callback) callback(err);
                    }
                );
            };
            if(!exists){
                fs.mkdir(Application.sessionDirectory+'/'+Application.name+'/', doSave);
            } else doSave();
        });
    },
    loadSession : function(key, callback){
        fs.readFile(Application.sessionDirectory+'/'+Application.name+'/'+key+'.json', 'utf8', 
            function(err, text){
                var data = {};
                if(err) console.log('ERROR', err);
                try{
                    data = JSON.parse(text);
                }catch(ex){
                    callback(ex, data);
                    return;
                }
                if(callback) callback(err, data);
            }
        );
    },
    newSessionKey : function(){
        return uuid.v1();
    }
};
Application.Connection = prime({
    session : {},
    sessionKey : '',
    constructor : function(request, response, callback){
        this.request = request;
        this.cookies = new Cookies(request, response);
        var complete = response.end;
        response.end = fn.bind(function(message){
            Application.saveSession(this.sessionID(), this.session);
            complete.apply(response, [message]);
        }, this);
        Application.loadSession(this.sessionID(), fn.bind(function(err, session){
            this.session = session;
            if(callback) callback(this);
        }, this));
    },
    getCookie : function(name){
        return this.cookies.get(name);
    },
    setCookie : function(name, value){
        return this.cookies.set(name, value);
    },
    getSession : function(name){
        return this.session[name];
    },
    sessionID : function(){
        if(!this.sessionKey){
            var key = this.getCookie('session_key');
            if(key){
                this.sessionKey = key;
            }else{
                this.sessionKey = Application.newSessionKey();
                this.setCookie('session_key', this.sessionKey);
            }
        }
        return this.sessionKey;
    },
    setSession : function(name, value){
        this.session[name] = value;
    },
    getPost : function(name){
        return this.request.post[name];
    },
    setPost : function(name, value){
        this.request.post[name] = value;
    },
    getGet : function(name){
        return this.request.get[name];
    },
    setGet : function(name){
        this.request.get[name] = value;
    },
    get : function(name){
        return this.request.get[name] || 
            this.request.post[name] || 
            this.session[name] || 
            this.cookies.get(name);
    }
});
Application.HTTP = new Class({
    Implements : [Options, EnhancedEmitter, InternalWorker],
    initialize : function(options){
        if(!options.passthru) options.passthru = [];
        var interface = (options.ssl && (options.ssl.pfx || options.ssl.key && options.ssl.certificate))?require('https'):require('http');
        var handler = fn.bind(function(request, response) {
            try{
                request.setEncoding("utf8");
                request.content = '';
                var random = 1 + Math.floor(Math.random()*1000000);
                request.addListener("data", function(chunk) {
                    request.content += chunk;
                });
                request.addListener("end", fn.bind(function(){
                    try{
                        request.post = qs.parse(request.content);
                    }catch(ex){
                        try{
                            request.post = JSON.stringify(request.content);
                        }catch(ex){}
                    }
                    var url = require('url');
                    var uri = url.parse(request.url, true);
                    var type = uri.pathname.lastIndexOf('.') != -1 ? uri.pathname.substring(uri.pathname.lastIndexOf('.')+1) : '!';
                    var path = uri.pathname;
                    request.get = uri.query;
                    type = path.lastIndexOf('.') != -1 ? path.substring(path.lastIndexOf('.')+1) : '!';
                    request.parts = {
                        path : path,
                        type : type,
                        url : uri
                    }
                    new Application.Connection(request, response, fn.bind(function(connection){
                        if(this.getConfiguration) connection.getConfiguration = this.getConfiguration;
                        if(this.setConfiguration) connection.setConfiguration = this.setConfiguration;
                        if(options.onServe) options.onServe(request, response, connection);
                    }, this));
                }, this));
            }catch(ex){
                response.writeHead(400, { "Content-Type" : "text/plain" });
                response.write(JSON.encode({
                    'error' : ex
                }));
                response.end();
            }
        }, this);
        this.setOptions(options);
        this.server = require('http').createServer(handler);
        this.addJob();
        this.server.on("listening", fn.bind(function(){
            this.removeJob();
        }, this));
        if(options.onListening) this.server.on("listening", options.onListening);
        if(
            (options.ssl && (
                options.ssl.pfx || options.ssl.key && options.ssl.certificate
            ))
        ) this.secure = require('https').createServer(handler);
    },
    start : function(callback){
        if(callback){
            var that = this;
            this.whenReady(function(){
                callback(that);
            });
        }
        if(this.server) this.server.listen(this.options.port || 80);
        if(this.secure) this.secure.listen(this.options.port || 80);
        return this;
    },
    stop : function(callback){
        if(this.server) this.server.close();
        if(this.secure) this.secure.close();
        return this;
    } ,
    openSocket : function(port, callback){ //todo: fix me so I can be lazy about connecting
        var io = require('socket.io').listen(port || this.server);
        //todo: secure sockets?
        this.addJob();
        io.set('log level', 1);
        io.sockets.on('connection', fn.bind(function (socket) {
            this.socket = socket;
            this.removeJob();
            if(callback) callback(socket);
        }, this));
    },
    addEvent : function(name, callback){
        this.whenReady(fn.bind(function(){
            //todo: maybe auto open
            if(!this.socket) throw('openSocket() must be called before attempting to add events');
            this.socket.on(name, callback);
        }, this));
    }
});

Application.WebServer = new Class({
    Extends : Application.HTTP,
    Implements : [Configurable],
    initialize : function(options){
        if(!options.passthru) options.passthru = [];
        if(options.onServe){
            var cb = options.onServe;
            options.onServe = function(request, response, connection){ //piggyback .onServe
                if(array.contains(options.passthru, type)){ //we just ship out a file
                    var fs = require('fs');
                    if(fs.exists(request.parts.url)){
                        fs.readFile(request.parts.url, 'utf8', function(err, fileBody){
                            //todo: 404 on err
                            var mime = require('mime');
                            response.setHeader("Content-Type", mime.lookup(file));
                            response.end(fileBody);
                        });
                    }
                }else if(cb) cb(request, response, connection);
            };
        }
        this.parent(options);
    }
});

module.exports = Application;