/**
 * Copyright (C) 2014 Glayzzle (BSD3 License)
 * @authors https://github.com/glayzzle/php-parser/graphs/contributors
 * @url http://glayzzle.com
 */
var fs = require('fs');
var cmd = require('./cmd');
var util = require('util');

module.exports = {
  handles: function(filename, ext) {
    if (ext == '.out') {
      fs.unlink(filename);
      return false;
    }
    return filename.indexOf("/token/") > -1 && (
      ext == '.php'
      || ext == '.phtml'
      || ext == '.html'
    );
  }
  ,run: function(filename, engine, opt) {
    if (engine.parser.debug) console.log(filename);
    // USING THE LEXER TO PARSE THE FILE :
    var hrstart, mem, jsTok;
    var fail = false, ignoreSize = false;
    var error = [[], []];

    if (engine.parser.debug) {
      hrstart = process.hrtime();
      mem = process.memoryUsage();
    }
    var buffer = fs.readFileSync(filename, {
      encoding: 'binary'
    });
    jsTok = engine.tokenGetAll(buffer);
    if (engine.parser.debug) {
      var  hrend = process.hrtime(hrstart);
      if (hrend[1] > 0)
      console.log(
        'Speed : ',
        (Math.round(jsTok.length / 1000) / 10) + 'K Tokens parsed at ',
        (Math.round(jsTok.length * 60000 / (hrend[1] / 1000000) / 1000 / 100) / 10) + 'M Token/sec - total time ',
        Math.round(hrend[1] / 100000) / 10, 'ms'
      );
      console.log('Memory : ', Math.round((process.memoryUsage().heapUsed - mem.heapUsed) / 1024), 'kb');
    }

    // USING THE PHP ENGINE TO PARSE
    var phpTok = false;
    var phpTokFilename = filename.replace('/token/', '/php-token/') + '.token';
    try {
      phpTok = JSON.parse(fs.readFileSync(phpTokFilename, { encoding: 'utf8' }));
    } catch(e) {
      if (engine.parser.debug) {
        console.log(phpTokFilename + '\n' + e.stack);
      }
    }
    if (opt.build || phpTok === false) {
      var result = cmd.exec('php -d short_open_tag=1 ' + (engine.lexer.asp_tags ? '-d asp_tags=1 ': '') + __dirname + '/token.php ' + filename);
      var phpTokPath = phpTokFilename.split('/');
      phpTokPath.pop(); // remove filename
      phpTokPath.forEach(function(dir, index) {
        var parent, dirPath;
        if (index > 0) {
          parent = phpTokPath.slice(0, index).join('/');
          dirPath = parent + '/' + dir;
        } else {
          dirPath = dir;
        }
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath);
        }
      });
      fs.writeFileSync(phpTokFilename, result.stdout, { encoding: 'utf8' });
      try {
        phpTok = JSON.parse(result.stdout);
      } catch(e) {
        console.log('Fail to parse output : ', result.stdout);
        if (engine.parser.debug) {
          throw e;
        } else {
          return true; // ignore this test : php can't parse the file
        }
      }
    }

    // CHECK ALL TOKENS
    for(var i = 0; i < phpTok.length; i++) {
      var p = phpTok[i];
      var j = jsTok[i];
      if (engine.parser.debug) {
        if (j instanceof Array) {
          console.log('JS('+j[2]+')  : ', j[0], j[1]);
        }
        if (p instanceof Array) {
          console.log('PHP('+p[2]+') : ', p[0], p[1]);
        }
      }
      if ( p instanceof Array ) {
        if ( j instanceof Array ) {
          if (p[0] != j[0]) { // check the token type
            console.log('FAIL : Expected ' + p[0] + ' token, but found ' + j[0]);
            fail = true;
          }
          if (p[0] === 'T_HALT_COMPILER' && !fail) {
            // should not check tokens after T_HALT_COMPILER
            // because php 5.x differs from php 7.x
            // @todo use by default the php7 behavior
            ignoreSize = true;
            break;
          }
          if (p[1] != j[1]) { // check the token contents
            j[1] = JSON.parse( JSON.stringify( j[1] ) );
            console.log('FAIL : Expected "' + p[1] + '" contents, but found "' + j[1] + '"');
            fail = true;
          }
          if (p[2] != j[2]) { // check the token line
            console.log('NOTICE : Expected line ' + p[2] + ', but found ' + j[2]);
            fail = true;
          }
        } else {
          console.log('FAIL : Expected ' + p[0] + ' token, but found "' + j + '" symbol');
          fail = true;
        }
      } else {
        if ( j !== p ) {
          console.log('FAIL : Expected "' + p + '", but found "' + j + '"');
          fail = true;
        }
      }
      if (fail) {
        error[0].push(j);
        error[1].push(p);
        break;
      }
    }

    // OUTPUT ERRORS IF FOUND
    if (!ignoreSize && phpTok.length != jsTok.length) {
      console.log('FAIL : Token arrays have not the same length !');
      fail = true;
    } /* */
    if (fail) {
      console.log('\nError at : ' + filename);
      console.log('\nJS Tokens', error[0]);
      console.log('PHP Tokens', error[1]);
      // ADD A LOG FILE (FOR ANALYSIS)
      fs.writeFileSync(
        filename + '.out',
        JSON.stringify(jsTok)
        + "\n\n" + JSON.stringify(phpTok)
      );
      return false;
    } else {
      // test the AST parser to ensure that the struture can be parsed
      try {
        var hrstart = process.hrtime();
        var parser = require('../../lib/src/index');
        var instance = new parser({
          lexer: {
            short_tags: false
          },
          parser: {
            extractDoc: true
          }
        });
        var ast = instance.parseCode(buffer, filename);
        var  hrend = process.hrtime(hrstart);
        if (hrend[1] && hrend[1] > 10000 * 50000) {
          console.log('Warning, slow parsing of ' + filename + ' ('+jsTok.length+' tokens in '+(Math.round(hrend[1] / 100000) / 10)+'ms)')
        }

        if (!ast || ast.kind !== 'program') throw new Error('not a program node');
        if (engine.parser.debug) {
          console.log(
            util.inspect(
              ast[1], {
                showHidden: false,
                depth: 10,
                colors: true
              }
            )
          );
        }
      } catch(e) {
        console.log('v - Passed ' + jsTok.length + ' tokens (but AST warning)');
        console.log(filename);
        console.log(e);
        return true;
      }

      if (engine.parser.debug) {
        console.log('v - Passed ' + jsTok.length + ' tokens');
      }
      return true;
    }
  }
};
