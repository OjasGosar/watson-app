if (!process.env.SLACK_TOKEN) {
    console.log('Error: Specify token in environment');
    process.exit(1);
}

var Botkit = require('botkit');
var os = require('os');
var Moment = require('moment-timezone');
var BeepBoop = require('beepboop-botkit');
var watson = require('watson-developer-cloud');

var personality_insights = watson.personality_insights({
    url: process.env.WATSON_PERSONALITY_INSIGHTS_API_URL,
    username: process.env.WATSON_PERSONALITY_INSIGHTS_USERNAME,
    password: process.env.WATSON_PERSONALITY_INSIGHTS_PASSWORD,
    version: process.env.WATSON_PERSONALITY_INSIGHTS_VERSION
});

var config = {}
if (process.env.MONGOLAB_URI) {
    var BotkitStorage = require('botkit-storage-mongo');
    config = {
        storage: BotkitStorage({mongoUri: process.env.MONGOLAB_URI}),
    };
} else {
    config = {
        json_file_store: './db_slackbutton_slash_command/',
    };
}

config.debug = true;
config.logLevel = 7;
config.retry = Infinity;

var controller = Botkit.slackbot(config);
var bot = controller.spawn({
    token: process.env.SLACK_TOKEN
}).startRTM();

//var beepboop = BeepBoop.start(controller, { debug: true });

controller.setupWebserver(process.env.PORT, function (err, webserver) {
    controller.createWebhookEndpoints(controller.webserver);
});


controller.hears(['help'], 'direct_message,direct_mention', function (bot, message) {
  bot.reply(message, "I am your Watson Bot :watson_bot:" +
    "\nI provide personality integration that provides disturbingly accurate personality insights.." +
    "\nTry `@watson_bot analyze` - to analyze personality insights of channel based on the channel history..");
});

controller.hears(['analyze'], 'direct_message,direct_mention,mention', function(bot, message){

    bot.api.reactions.add({
        timestamp: message.ts,
        channel: message.channel,
        name: 'thinking_face',
    }, function(err, res) {
        if (err) {
            bot.botkit.log('Failed to add emoji reaction :(', err);
        }
    });

    bot.api.channels.history({
        channel: message.channel,
    }, function(err, history) {
        if (err) {
            console.log('ERROR', err);
        }

        var messages = [];
        for (var i = 0; i < history.messages.length; i++) {
            messages.push(history.messages[i].text);
        }

        var corpus = messages.join("\n");

        personality_insights.profile(
            {
                text: corpus,
                language: 'en'
            },
            function(err, response) {
                if (err) {
                    console.log('error:', err);
                } else {
                    bot.startConversation(message,function(task, convo) {

                        var top5 = response.tree.children[0].children[0].children;
                        console.log(top5);
                        for (var c = 0; c< top5.length; c++) {

                            convo.say('This Channel has ' + Math.round(top5[c].percentage*100) + '% ' + top5[c].name);
                        }
                        bot.reply(message,"");
                    });
                }
            }
        );

    });
});


controller.on('bot_channel_join', function (bot, message) {
    console.log("bot_channel_join")
  bot.reply(message, "I'm here!")
});

controller.hears(['hello', 'hi'], 'direct_message,direct_mention,mention', function(bot, message) {

    bot.api.reactions.add({
        timestamp: message.ts,
        channel: message.channel,
        name: 'robot_face',
    }, function(err, res) {
        if (err) {
            bot.botkit.log('Failed to add emoji reaction :(', err);
        }
    });


    controller.storage.users.get(message.user, function(err, user) {
        if (user && user.name) {
            bot.reply(message, 'Hello ' + user.name + '!!');
        } else {
            bot.reply(message, 'Hello.');
        }
    });
});

controller.hears(['call me (.*)', 'my name is (.*)'], 'direct_message,direct_mention,mention', function(bot, message) {
    var name = message.match[1];
    controller.storage.users.get(message.user, function(err, user) {
        if (!user) {
            user = {
                id: message.user,
            };
        }
        user.name = name;
        controller.storage.users.save(user, function(err, id) {
            bot.reply(message, 'Got it. I will call you ' + user.name + ' from now on.');
        });
    });
});

controller.hears(['what is my name', 'who am i'], 'direct_message,direct_mention,mention', function(bot, message) {

    controller.storage.users.get(message.user, function(err, user) {
        if (user && user.name) {
            bot.reply(message, 'Your name is ' + user.name);
        } else {
            bot.startConversation(message, function(err, convo) {
                if (!err) {
                    convo.say('I do not know your name yet!');
                    convo.ask('What should I call you?', function(response, convo) {
                        convo.ask('You want me to call you `' + response.text + '`?', [
                            {
                                pattern: 'yes',
                                callback: function(response, convo) {
                                    // since no further messages are queued after this,
                                    // the conversation will end naturally with status == 'completed'
                                    convo.next();
                                }
                            },
                            {
                                pattern: 'no',
                                callback: function(response, convo) {
                                    // stop the conversation. this will cause it to end with status == 'stopped'
                                    convo.stop();
                                }
                            },
                            {
                                default: true,
                                callback: function(response, convo) {
                                    convo.repeat();
                                    convo.next();
                                }
                            }
                        ]);

                        convo.next();

                    }, {'key': 'nickname'}); // store the results in a field called nickname

                    convo.on('end', function(convo) {
                        if (convo.status == 'completed') {
                            bot.reply(message, 'OK! I will update my dossier...');

                            controller.storage.users.get(message.user, function(err, user) {
                                if (!user) {
                                    user = {
                                        id: message.user,
                                    };
                                }
                                user.name = convo.extractResponse('nickname');
                                controller.storage.users.save(user, function(err, id) {
                                    bot.reply(message, 'Got it. I will call you ' + user.name + ' from now on.');
                                });
                            });



                        } else {
                            // this happens if the conversation ended prematurely for some reason
                            bot.reply(message, 'OK, nevermind!');
                        }
                    });
                }
            });
        }
    });
});

controller.hears(['identify yourself', 'who are you', 'what is your name'],
    'direct_message,direct_mention,mention', function(bot, message) {

    var hostname = os.hostname();
    var uptime = formatUptime(process.uptime());

    bot.reply(message,
        ':robot_face: I am a bot named <@' + bot.identity.name +
        '>. I have been running for ' + uptime + ' on ' + hostname + '.' +
        '\n I have been created by Mr. Ojas Gosar');

});

function formatUptime(uptime) {
    var unit = 'second';
    if (uptime > 60) {
        uptime = uptime / 60;
        unit = 'minute';
    }
    if (uptime > 60) {
        uptime = uptime / 60;
        unit = 'hour';
    }
    if (uptime != 1) {
        unit = unit + 's';
    }

    uptime = uptime + ' ' + unit;
    return uptime;
}
