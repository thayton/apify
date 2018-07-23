const puppeteer = require('puppeteer');
const url = 'https://myaccount.rid.org/Public/Search/Member.aspx';

/*
 * Wait until elem becomes detached from DOM
 */
async function waitUntilStale(page, elem) {
    await page.waitForFunction(
        e => !e.ownerDocument.contains(e),
        { polling: 'raf' }, elem
    );
}

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
    let resultsTable = await page.$('#FormContentPlaceHolder_Panel_resultsGrid');    

    await page.select(`select[name="${pageSizeName}"]`, '50');

    /*
     * Selecting the page size triggers an ajax request for the new table results. 
     * We need to wait until that new table data gets loaded before trying to scrape.
     * So we wait until the old member table gets detached from the DOM as the signal
     * that the new table has been loaded
     */
    await waitUntilStale(page, resultsTable);
}

/*------------------------------------------------------------------------------
 * Look for link for pageno in pager. So if pageno was 6 we'd look for 'Page$6' 
 * in href:
 *
 * <a href="javascript:__doPostBack('ctl00$FormContentPlaceHolder$Panel$resultsGrid','Page$6')">...</a>
 *
 * After the next page link gets clicked and the new page is loaded the pager
 * will show the current page within a span (not as a link). So we wait until 
 * pageno appears within a span to indicate that the next page has finished 
 * loading.
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
 * Go back to the first page of results in order to reset the pager. Once the 
 * first page link is clicked and becomes the current page the page 1 link will 
 * appear inside of <span>1</span>. So we can determine once page 1 has finished
 * loading by wait inguntil page 1 appears inside of this span. 
 *
 * Note that there might not be a page 1 link because there was only one page of 
 * results. In that case the page will still show up as <span>1</span> element. 
 */
async function gotoFirstPage(page) {
    let firstPageLinkXp = `//tr[@class='PagerStyle']/td/table/tbody/tr/td/a[contains(@href,'Page$1')]`;
    let firstPageCurrXp = `//tr[@class='PagerStyle']/td/table/tbody/tr/td/span[text()='1']`;
    let firstPage;

    firstPage = await page.$x(firstPageLinkXp);

    if (firstPage.length > 0) {
        await firstPage[0].click();
    }
    
    await page.waitForXPath(firstPageCurrXp);    
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

    /*
     * The pager won't reset back to page 1 on its own so we have to explicitly 
     * click on the page 1 link
     */
    await gotoFirstPage(page);
    return results;
}

async function main() {
    //const browser = await puppeteer.launch({ headless: false, slowMo: 250 });
    const browser = await puppeteer.launch({ headless: true, args: [ '--start-fullscreen' ] });
    const page = await browser.newPage();

    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    
    await page.goto(url);
    
    let states = await getStates(page);
    
    for (const [ i, state ] of states.entries()) {
        console.log(`[${i+1}/${states.length}] Scraping data for ${state.name}`);
        
        await page.select('#FormContentPlaceHolder_Panel_stateDropDownList', state.value);
        await page.select('#FormContentPlaceHolder_Panel_freelanceDropDownList', '1');

        /*
         * The first time we run a search we can wait for the table to appear to determine
         * once the search has loaded the results. However, with subsequent searches the 
         * table already exists and what we need to determine is when the table contents have 
         * been updated. To do that we fetch a reference to the table here and then wait for 
         * it to become stale (detached) as an indication that the new table data has loaded.
         */
        let resultsTable = await page.$('table#FormContentPlaceHolder_Panel_resultsGrid');
        
        await page.click('#FormContentPlaceHolder_Panel_searchButtonStrip_searchButton');

        if (resultsTable) {
            await waitUntilStale(page, resultsTable);
        } else {
            await page.waitForSelector('#FormContentPlaceHolder_Panel_resultsGrid');
        }

        if (i === 0) {
            await setMaxPageSize(page);
        }

        let data = await scrapeAllPages(page);
        console.log(`Got ${data.length} records in all`);

        if (i >= 2) {
            break;
        }
    }

    await page.close();
    browser.close();
}

main();
