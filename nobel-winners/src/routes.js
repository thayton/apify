const Apify = require('apify');
const { utils: { log } } = Apify;
const { URL } = require('url');

const resolveUrl = (href, baseUrl) => {
    const url = new URL(href, baseUrl);
    return url.href;
};

const resolveRelativeUrls = (htmlStr, baseUrl, $) => {
    let d = $(`<div>${htmlStr}</div>`)
    
    $('a:not([href^=http])', d).each((i,a) => {
        $(a).attr('href', resolveUrl( $(a).attr('href'), baseUrl ));
    });

    return d.html();
};

const processWinner = (country, li, $) => {
    data = {};
    text = $(li).text();

    data['text'] = text;
    data['name'] = text.split(',')[0];
    data['href'] = $(li).find('a').attr('href');
    
    year = text.match(/\d{4}/);
    data['year'] = year !== null ? Number(year[0]) : 0;

    category = text.match(/Physics|Chemistry|Physiology or Medicine|Literature|Peace|Economics/)
    data['category'] = category !== null ? category[0] : '';

    if (country) {
        if (text.indexOf('*') != -1) {
            data['country'] = '';
            data['born_in'] = country;
        } else {
            data['country'] = country;
            data['born_in'] = '';
        }
    }

    return data;
};

exports.handleStart = async ({ request, $, crawler: { requestQueue } }) => {
    const winners = [];
    
    $('h3 > span.mw-headline').each((i,span) => {
        let country = $(span).text();
        
        $(span).parent('h3').next('ol').find('li').each((i,li) => {
            winner = processWinner(country, li, $);
            winners.push(winner);
        });
    });

    log.info(`Scraped ${winners.length} winners`);
    
    const createBioRequest = (winner) => {
        const url = new URL(winner['href'], request.loadedUrl);
        const req = new Apify.Request({ url: url.href });
    
        req.userData.winner = winner;
        req.userData.label = 'BIO';

        return req;
    };

    const requests = winners.map(w => createBioRequest(w));
    for (const req of requests) {
        await requestQueue.addRequest(req);
    }
};

exports.handleWikidata = async ({ request, $ }) => {
    const winner = request.userData.winner;
    const propertyCodes = [
        { 'name': 'date_of_birth',  'code': 'P569' },
        { 'name': 'date_of_death',  'code': 'P570' },
        { 'name': 'place_of_birth', 'code': 'P19'  },
        { 'name': 'place_of_death', 'code': 'P20'  },
        { 'name': 'gender',         'code': 'P21'  },
    ];

    const getText = (el) => $(el).contents().filter((i,e)=>e.nodeType == 3).text();
    
    for (const pc of propertyCodes) {
        let div = $(`div#${pc['code']}`);

        if (div.length) {
            let d = $(div).find('div.wikibase-snakview-body > div.wikibase-snakview-value').first();
            let a = $(d).find('a');
            let k = pc['name'];
            let v = a.length ? getText(a) : getText(d);
      
            winner[k] = v;
            log.debug(`winner[${k}] = ${winner[k]}`);
        }
    }

    await Apify.pushData(winner);
};

/* 
 * Find the first <p> after the infoblox table and collect
 * that any subsequent <p> elements until we encounter the
 * first non <p> element which marks then of the mini-bio.
 */
const getMiniBio = ($) => {
    let mini_bio = '';
    let p = $('table.infobox').next('p');

    mini_bio += p.html();
    mini_bio += $(p).nextUntil(':not(p)').map(
        (i,e) => $(e).html()
    ).get().join();

    return mini_bio;
};

exports.handleBio = async ({ request, $, crawler: { requestQueue } }) => {
    const winner = request.userData.winner;
    
    winner['mini_bio'] = getMiniBio($);
    winner['mini_bio'] = resolveRelativeUrls(winner['mini_bio'], request.loadedUrl, $);

    log.debug(`data => ${JSON.stringify(winner)}`);

    wikidata_link = $('li#t-wikibase > a').attr('href');

    const req = new Apify.Request({ url: wikidata_link });
    
    req.userData.winner = request.userData.winner;
    req.userData.label = 'WIKIDATA';

    await requestQueue.addRequest(req);
};
