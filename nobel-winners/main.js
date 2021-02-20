const Apify = require('apify');
const { handleStart, handleWikidata, handleBio } = require('./src/routes');

const { utils: { log } } = Apify;

Apify.main(async () => {
    const { startUrls } = await Apify.getInput();
    const requestList = await Apify.openRequestList('start-urls', startUrls);
    const requestQueue = await Apify.openRequestQueue();

    log.setLevel(log.LEVELS.DEBUG);
    
    const crawler = new Apify.CheerioCrawler({
        requestList,
        requestQueue,
        maxConcurrency: 50,
        handlePageFunction: async (context) => {
            const { url, userData: { label } } = context.request;
            log.info('Page opened.', { label, url });
            switch (label) {
                case 'WIKIDATA':
                    return handleWikidata(context);
                case 'BIO':
                    return handleBio(context);
                default:
                    return handleStart(context);
            }
        },
    });

    log.info('Starting the crawl.');
    await crawler.run();
    log.info('Crawl finished.');
});
