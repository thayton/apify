const Apify = require('apify');
const fetch = require("node-fetch");
const { URL } = require('url');

const {
    utils: { log },
} = Apify;

const { validateInput } = require('./utils');

log.setLevel(log.LEVELS.DEBUG);
log.setOptions({
    logger: new log.LoggerText({ skipTime: false }),
});

const NUM_ITEMS = 100;

const addCarInfo = (item) => {
    const dealer = item['dealer'];        
    const car = {
        dealer: {
            url: dealer.dealer_url,
            name: dealer.name,
            phone: dealer.phone,
            email: dealer.email,
            zipCode: dealer.postcode,
            address: dealer.line_address.join(', ')
        },
        vin: item.ids['vin'],
        url: (new URL(item.main_info['seo_url'], 'https://preowned.ferrari.com')).href,
        specs: {...item['translations']['default'] },
        images: []
    };

    for (const [k,v] of Object.entries(item.images.list_430)) {
        car.images.push('https:' + v);
    }

    log.debug(`Adding car with VIN ${car.vin}`);
    return Apify.pushData(car);
};

Apify.main(async () => {
    const input = await Apify.getInput();
    validateInput(input);

    const {
        location,
        radius,
        maxItems = null
    } = input;
    
    const data = {
        search: {
            "sumname":"filtered",
            "return":"list",
            "summary_fields_dynamic":[
                "make",
                "sub_brand",
                "class",
                "model",
                "body_type",
                "price",
                "odometer",
                "metacolour",
                "fuel",
                "transmission",
                "year",
                "ranges",
                "model_variant",
                "equipment_meta"
            ],
            "tree_type":"cl_lp-mo_bo-lp",
            "currency_locale":"en_US",
            "distance_unit":"mi",
            "currency":"USD",
            "lang":"en_gb",
            "include_special_prices":"1",
            "equipment_meta_uncombined":"1",
            "project":{
                "ids.vin":"",
                "ids.oracle_id":"",
                "main_info.approved":"",
                "main_info.make":"",
                "main_info.reg_year":"",
                "main_info.model":"",
                "main_info.seo_url":"",
                "main_info.price_special":"",
                "dealer.dealer_url":"",
                "dealer.phone":"",
                "dealer.email":"",
                "dealer.name":"",
                "dealer.postcode":"",
                "dealer.country":"",
                "dealer.line_address":"",
                "dealer.cms_id":"",
                "dealer.code":"",
                "dealer.town":"",
                "translations.default.year_make_model":"",
                "translations.default.price_formated":"",
                "translations.default.colour_with_trim":"",
                "translations.default.odometer":"",
                "translations.default.fuel_string":"",
                "translations.default.interior":"",
                "translations.default.body_type":"",
                "translations.default.capacity_string":"",
                "translations.default.transmission":"",
                "translations.default.colour":"",
                "images.count":"",
                "images.list_430.img_1":"",
                "images.list_430.img_2":""
            },
            "order":[
                "priced"
            ],
            "market":[
                "ferrari united states"
            ],
            "hits":{
                "from":0,
                "to":maxItems === null || maxItems === 0 ? NUM_ITEMS : Math.min(maxItems, NUM_ITEMS)
            }
        },
        totals_search: {
            "sumname":"unfiltered",
            "return":"count",
            "summary_fields_dynamic":[
                "make",
                "sub_brand",
                "class",
                "model",
                "body_type",
                "price",
                "odometer",
                "metacolour",
                "fuel",
                "transmission",
                "year",
                "ranges",
                "model_variant",
                "equipment_meta"
            ],
            "tree_type":"cl_lp-mo_bo-lp",
            "currency_locale":"en_US",
            "distance_unit":"mi",
            "currency":"USD",
            "lang":"en_gb",
            "include_special_prices":"1",
            "equipment_meta_uncombined":"1",
            "market":[
                "ferrari united states"
            ]
        },
        timestamp: Math.floor(Date.now() / 1000)
    };

    if (location !== undefined && radius !== undefined) {
        data.search.location = location;
        data.search.distance = radius;
    }
    
    data.search = JSON.stringify(data.search);
    data.totals_search = JSON.stringify(data.totals_search);
    
    for (let i = 0; i < 10; i++) {
        body = new URLSearchParams(data);
    
        let resp = await fetch('https://preowned.ferrari.com/vdata', {
            method: 'POST',
            headers: {
                'x-requested-with': 'XMLHttpRequest'
            },
            body: body
        });

        let resp_data = await resp.json();
        if (resp_data.vehicles.length === 0) {
            break;
        }

        log.debug(`Got back ${resp_data.vehicles.length} vehicles`);

        resp_data.vehicles.forEach(v => addCarInfo(v));

        if (maxItems && maxItems > 0 && vehicles.length > maxItems)
            break;
        
        data.search = JSON.parse(data.search);
        
        data.search.hits.from = data.search.hits.to;
        data.search.hits.to += NUM_ITEMS;
        
        data.search = JSON.stringify(data.search);
    }

    log.info('Scraper finished');
});
