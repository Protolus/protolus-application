//todo: events support
var prime = require('prime');
var Class = require('Classy');
var type = require('prime/util/type');
var string = require('prime/es5/string');
var array = require('prime/es5/array');
array.forEachEmission = function(collection, callback, complete){ //one at a time
    var a = {count : 0};
    var fn = function(collection, callback, complete){
        if(a.count >= collection.length){
            if(complete) complete();
        }else{
            callback(collection[a.count], a.count, function(){
                a.count++;
                fn(collection, callback, complete);
            });
        }
    };
    fn(collection, callback, complete);
};
array.forAllEmissions = function(collection, callback, complete){ //parallel
    var a = {count : 0};
    var begin = function(){
        a.count++;
    };
    var finish = function(){
        a.count--;
        if(a.count == 0 && complete) complete();
    };
    array.forEach(collection, function(value, key){
        begin();
        callback(value, key, function(){
           finish(); 
        });
    });
};
array.combine = function(thisArray, thatArray){ //parallel
    var result = [];
    array.forEach(thatArray, function(value, key){
        result.push(value);
    });
    return result;
};
array.contains = function(haystack, needle){ //parallel
    return haystack.indexOf(needle) != -1;
};
prime.keys = function(object){
    var result = [];
    for(var key in object) result.push(key);
    return result;
};
prime.values = function(object){
    var result = [];
    for(var key in object) result.push(object[key]);
    return result;
};
prime.interleave = function(data, object){
    prime.each(data, function(item, key){
        if(type(item) == 'object' && type(object[key]) == 'object') object[key] = prime.interleave(item, object[key]);
        else object[key] = item;
    });
    return prime.clone(object);
};
prime.clone = function(obj){
    var result;
    switch(type(obj)){
        case 'object':
            result = {};
            for(var key in obj){
                result[key] = prime.clone(obj[key]);
            }
            break;
        case 'array':
            result = obj.slice(0);
            break;
        default : result = obj;
    }
    return result;
};
prime.merge = function(objOne, objTwo){
    var result = {};
    prime.forEach(objOne, function(item, key){
        result[key] = item;
    });
    prime.forEach(objTwo, function(item, key){
        if(!result[key]) result[key] = item;
    });
    return result;
};
string.startsWith = function(str, sub){
    return str.indexOf(sub) === 0; //likely more expensive than needed
};
string.endsWith = function(str, sub){
    return str.substring(str.length-sub.length) === sub;
};
var fn = require('prime/es5/function');
var regexp = require('prime/es5/regexp');
var Emitter = require('prime/util/emitter');
var fs = require('fs');

var Options = new Class({
    setOptions : function(options){
        if(!this.options) this.options = {};
        var value;
        for(var key in options){
            value = options[key];
            if(this.on && key.substring(0,2) == 'on' && key.substring(2,3) == key.substring(2,3).toUpperCase()){
                var event = key.substring(2,3).toLowerCase()+key.substring(3);
                this.on(event, value);
            }
            this.options[key] = value;
        }
    }
});

var EnhancedEmitter = prime({
    inherits: Emitter,
    once : function(type, fn){
        var ob = this;
        function cb(){
            ob.off(type, cb);
            fn();
        }
        this.on(type, cb);
    }
});

var InternalWorker = prime({
    working: 0,
    deferredWork : [],
    ready : function(){
        return !(this.working > 0);
    },
    addJob : function(job){
        this.working++;
    },
    removeJob : function(job){
        this.working--;
        if(this.working == 0 && this.deferredWork.length > 0){ //flush the queue
            var queue = this.deferredWork;
            this.deferredWork =[];
            array.forEach(queue, function(callback){
                callback();
            });
        }
        if(this.emit) this.emit('ready');
    },
    whenReady : function(callback){
        if(!this.ready()){
            this.deferredWork.push(callback);
        }else callback();
    }
});

var Configurable = new Class({
    configurations : {application: {extra:'fun'}},
    getConfiguration : function(key){
        var parts = key.split('.');
        var current = this.configurations;
        while(parts.length > 0){
            current = current[parts.shift()];
            if(!current) return undefined;
        }
        return current;
    },
    setConfiguration : function(key, value){
        var parts = key.split('.');
        var current = this.configurations;
        while(parts.length > 0){
            var part = parts.shift();
            if(!current[part]) current[part] = {};
            current = current[part];
        }
        current = value;
    },
    loadConfiguration : function(file, callback){
        fs.readFile(file, 'utf8', fn.bind(function(err, data){
            if(err) throw('Cannot find configuration file');
            data = JSON.parse(data);
            data = prime.interleave(data, this.configurations);
            callback(data);
        }, this));
    }
});

var Application = {};
Application.HTTP = new Class({
    Implements : [Options, EnhancedEmitter, InternalWorker],
    initialize : function(options){
        if(!options.passthru) options.passthru = [];
        var interface = (options.ssl && (options.ssl.pfx || options.ssl.key && options.ssl.certificate))?require('https'):require('http');
        var handler = fn.bind(function(request, response) {
            var url = require('url');
            var uri = url.parse(request.url, true);
            var type = uri.pathname.lastIndexOf('.') != -1 ? uri.pathname.substring(uri.pathname.lastIndexOf('.')+1) : '!';
            var path = uri.pathname;
            type = path.lastIndexOf('.') != -1 ? path.substring(path.lastIndexOf('.')+1) : '!';
            request.parts = {
                path : path,
                type : type,
                url : uri
            }
            if(options.onServe) options.onServe(request, response);
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
        if(callback) this.whenReady(callback);
        if(this.server) this.server.listen(this.options.port || 80);
        if(this.secure) this.secure.listen(this.options.port || 80);
        return this;
    },
    stop : function(callback){
        //if(callback) this.whenReady(callback);
        //if(callback) this.once('stopped', callback);
        if(this.server) this.server.close();
        if(this.secure) this.secure.close();
        return this;
    } 
});

Application.WebServer = new Class({
    Extends : Application.HTTP,
    Implements : [Configurable],
    initialize : function(options){
        if(!options.passthru) options.passthru = [];
        if(options.onServe){
            var cb = options.onServe;
            options.onServe = function(request, response){ //piggyback .onServe
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
                }else if(cb) cb(request, response);
            };
        }
        this.parent(options);
    }
});

module.exports = Application;