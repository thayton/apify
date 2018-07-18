const puppeteer = require('puppeteer');
const url = 'https://myaccount.rid.org/Public/Search/Member.aspx';

async function getSelectOptions(page, selector) {
    const options = await page.evaluate(optionSelector => {
        return Array.from(document.querySelectorAll(optionSelector))
            .filter(o => o.value)
            .map(o => {
                return {
                    name: o.text,
                    value: o.value
                };
            });        
    }, selector);

    return options;
}

async function getStates(page) {
    return await getSelectOptions(page, 'select#FormContentPlaceHolder_Panel_stateDropDownList > option');
}

async function setMaxPageSize(page) {
    let html = await page.content();
    let pageSizeNameRe = new RegExp(
        'ctl00\\$FormContentPlaceHolder\\$Panel\\$resultsGrid\\$ctl\\d+\\$ctl\\d+'
    );

    let match = pageSizeNameRe.exec(html);
    if (match.length <= 0) {
        return;
    } 

    let pageSizeName = match[0];
    let memberTable = await page.$('#FormContentPlaceHolder_Panel_resultsGrid');    

    await page.select(`select[name="${pageSizeName}"]`, '50');
    
    /*
     * Selecting the page size triggers an ajax request for the new member table data.
     * We need to wait until that new table data gets loaded before trying to scrape.
     * So we wait until the old member table gets detached from the DOM as the signal
     * that the new table has been loaded
     */
    await page.waitForFunction(
        e => !e.ownerDocument.contains(e),
        { polling: 'raf' }, memberTable
    );
}

/*------------------------------------------------------------------------------
 * Look for link for pageno in pager. So if pageno was 6 we'd look for 'Page$6' 
 * in href:
 *
 * <a href="javascript:__doPostBack('ctl00$FormContentPlaceHolder$Panel$resultsGrid','Page$6')">...</a>
 *
 * After the next page link gets clicked and the new page is loaded the pager
 * will show the current page within a span (not as a link). So we wait until 
 * pageno appears within a span to indicate that the next page is finished loading.
 */ 
async function gotoNextPage(page, pageno) {
    let noMorePages = true;
    let nextPageXp = `//tr[@class='PagerStyle']/td/table/tbody/tr/td/a[contains(@href,'Page$${pageno}')]`;
    let currPageXp = `//tr[@class='PagerStyle']/td/table/tbody/tr/td/span[text()='${pageno}']`;
    let nextPage;

    nextPage = await page.$x(nextPageXp)
    
    if (nextPage.length > 0) {
        console.log(`Going to page ${pageno}`);
        
        await nextPage[0].click();
        await page.waitForXPath(currPageXp);
        
        noMorePages = false;
    }

    return noMorePages;    
}

/*------------------------------------------------------------------------------
 * Go back to the first page of results in order to reset the pager. We have to
 * deal with the following cases:
 * (1) Page 1 link is available
 * (2) '<<' link is available. Once we go to page 6 and beyond the pager stops
 *     showing the page 1 link and we have to click on the '<<' link in order to
 *     get back to page 1
 * (3) There's no page 1 link because there's only one page of results and so
 *     there's only a <span>1</span> where the page 1 link would have been
 */
async function gotoFirstPage(page) {
    let pagerXp = `//tr[@class='PagerStyle']/td/table/tbody/tr/td/`;    
    let firstPage;

    // (1)
    firstPage = await page.$x(pagerXp + `a[text()='1']`);
    
    // (2)    
    if (firstPage.length === 0) {
        firstPage = await page.$x(pagerXp + `a[text()='<<']`);
    }

    // (3)
    if (firstPage.length === 0) {
        firstPage = await page.$x(pagerXp + `span[text()='1']`);
        
        if (firstPage.length > 0) {
            firstPage = null;
        }
    }

    if (firstPage) {
        await firstPage[0].click();
    }
}

async function scrapeMemberTable(page) {
    const data = await page.evaluate(() => {
        const ths = Array.from(document.querySelectorAll('table th'));
        const trs = Array.from(document.querySelectorAll('table tr.RowStyle'));
        const headers = ths.map(th => th.innerText);

        let results = [];

        console.log(`${trs.length} rows in member table!`);
        
        trs.forEach(tr => {
            let r = {};            
            let tds = Array.from(tr.querySelectorAll('td')).map(td => td.innerText);

            headers.forEach((k,i) => r[k] = tds[i]);
            results.push(r);
        });

        return results;
    });

    console.log(`Got ${data.length} records`);
    return data;
}

async function scrapeAllPages(page) {
    let results = [];
    let pageno = 2;
    
    while (true) {
        console.log(`Scraping page ${pageno - 1}`);
        
        results = results.concat(
            await scrapeMemberTable(page)
        );

        const noMorePages = await gotoNextPage(page, pageno++)
        if (noMorePages) {
            break;
        }
    }

    // The pager won't reset back to page 1 on its own
    // so we have to explicitly click on the page 1 link
    //await gotoFirstPage(page);
    return results;
}

async function run() {
    //const browser = await puppeteer.launch({ headless: false, slowMo: 250 });
    const browser = await puppeteer.launch({ headless: true, args: [ '--start-fullscreen' ] });
    const page = await browser.newPage();

    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    
    await page.goto(url);

    let states = await getStates(page);
    
    for (state of states) {
        console.log(`Scraping data for ${state.name}`);
        
        await page.select('#FormContentPlaceHolder_Panel_stateDropDownList', state.value);
        await page.select('#FormContentPlaceHolder_Panel_freelanceDropDownList', '1');

        await page.click('#FormContentPlaceHolder_Panel_searchButtonStrip_searchButton');
        await page.waitForSelector('#FormContentPlaceHolder_Panel_resultsGrid');

        await setMaxPageSize(page);

        let data = await scrapeAllPages(page);
        console.log(`Got ${data.length} records in all`);
        break;
    }

    browser.close();
};

run();
