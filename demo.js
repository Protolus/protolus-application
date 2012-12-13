var ProtolusApplication = require('./protolus-application');
var application = new ProtolusApplication.WebServer({
    port : 80,
    onServe : function(request, response){
        response.end('OMGWTFBBQ');
    }
});
application.start();