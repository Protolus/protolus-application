var should = require("should");
var request = require("request");
var Application = require('./protolus-application');
var port = 221;

describe('Protolus.Application', function(){
    describe('can serve', function(){
        var application;
        var running = false;
        before(function(done){
            try{
                application = new Application.WebServer({
                    port : port,
                    onServe : function(request, response){
                        response.end('OMGWTFBBQ');
                    },
                    onListening :function(){
                        running = true;
                        done();
                    }
                });
                application.start();
            }catch(ex){
                should.not.exist(ex);
            }
        });
        
        it('Server Runs', function(){
            should.equal(running, true);
        });
        
        it('a response', function(done){
            request('http://localhost:'+port, function (error, response, body) {
                if (!error && response.statusCode == 200) {
                    body.should.not.equal('');
                }
                if(error) should.fail('Error fetching URL', error);
                if(response.statusCode != 200) should.fail('Fetch not OK', 'Code:'+response.statusCode);
                body.should.equal('OMGWTFBBQ');
                done();
            });
        });
        
    });
});