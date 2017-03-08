const fs = require('fs');

const request = require('request');
const cheerio = require('cheerio');
const mongoose = require('mongoose');
const _ = require('lodash');
const SparkPost = require('sparkpost');


const sparky = new SparkPost(); // uses process.env.SPARKPOST_API_KEY

// check that we have the required config
['LEBONCOIN_URL', 'LEBONCOIN_EMAIL'].forEach(function(v) {
  if (!process.env.hasOwnProperty(v)) {
    console.log(`missing ${v} in process.env`);
    process.exit(-1);
  }
})


mongoose.Promise = global.Promise;

const Match = mongoose.model('Match', {
  title: String,
  link: {
    type: String,
    unique: true
  },
  seen: {
    type: Boolean,
    default: false
  }
});

const getHTML = function() {
  return new Promise(function(resolve, reject) {
    request.get(process.env.LEBONCOIN_URL,  function (err, response, body) {
      if (err) {
        return reject(err);
      }
      if (!response) {
        return reject('(weird) response is null/undefined');
      }
      if (response.statusCode !== 200) {
        return reject(`statusCode != 200 (${response.statusCode})`);
      }
      return resolve(body);
    });
  });

}

const parseHtmlAndExtractElts = function(htmlText) {
  const $ = cheerio.load(htmlText);
  let listItems = $('.list_item');
  if (listItems) {
    listItems = listItems.toArray();
  }
  return Promise.resolve(listItems);
}

const extractInfosFromElt = function(elt) {
  const title = elt.attribs.title;
  let link = elt.attribs.href;

  // add http in front if absolute link
  if (link.startsWith('//')) {
    link = `http:${link}`;
  }
  // remove query string
  link = link.split('?')[0];

  return { title, link };
}

/*
 * Returns a Promise, optionaly providing the item if it's a new one
 */
const handleItem = function(item) {
  let match = new Match(item);
  return match.save()
  .then(function(res) {
    return Promise.resolve(item);
  })
  .catch(function(err) {
    if (err instanceof mongoose.mongo.MongoError && err.code === 11000) {
      // duplicate -> the item was already there
      return Promise.resolve();
    }
    return Promise.reject(err);
  });
}

const handleElt = function(elt) {
  const item = extractInfosFromElt(elt);
  if (item) {
    return handleItem(item);
  } else {
    return Promise.reject('failure');
  }
}

const extractInfosFromAllElts = function(elts) {
  return Promise.all(_.map(elts, function(elt) { return extractInfosFromElt(elt) }));
}

const handleAllItems = function(items) {
  return Promise.all(_.map(items, function(item) { return handleItem(item) }));
}

const filterEmptyResults = function(results) {
  _.remove(results, _.isNil);
  return Promise.resolve(results);
}

const sendEmail = function(newLinks) {
  if (!newLinks || !newLinks.length) {
    // nothing to do
    console.log("no new links");
    return ;
  }
  console.log(newLinks);

  const htmlListItems = _.map(newLinks, (l) => `<li><a href=${l.link}>${l.title}</a></li>`).join('')
  console.log(htmlListItems);

  return sparky.transmissions.send({
    options: {
      sandbox: true
    },
    content: {
      from: 'testing@' + process.env.SPARKPOST_SANDBOX_DOMAIN, // 'testing@sparkpostbox.com'
      subject: 'New results on leboncoin !',
      html:`<html><body><p>New results on leboncoin</p><ul>${htmlListItems}</ul></body></html>`
    },
    recipients: [
      {
        address: process.env.LEBONCOIN_EMAIL
      }
    ]
  })
  .then(function(data) {
    console.log(`sent email for ${newLinks.length} new results`);
  });
}

getHTML()
.then(parseHtmlAndExtractElts)
.then(function(elts) {
  if (elts && elts.length) {
    console.log(`${elts.length} elt${(elts.length > 1) ? 's' : ''}`);
    mongoose.connect(process.env.MONGODB_URI);

    return extractInfosFromAllElts(elts)
    .then(handleAllItems)
    .then(filterEmptyResults)
    .then(sendEmail)
    .catch(function(err) {
      console.log("ERR", err);
    })
    .then(function() {
      mongoose.disconnect();
    })
  } else {
    console.log('no items');
  }
});
