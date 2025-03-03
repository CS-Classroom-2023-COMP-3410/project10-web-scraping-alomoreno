const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs-extra');

const COURSE_URL = 'https://bulletin.du.edu/undergraduate/majorsminorscoursedescriptions/traditionalbachelorsprogrammajorandminors/computerscience/#coursedescriptionstext';
const ATHLETICS_URL = 'https://denverpioneers.com/index.aspx';
const CAL_URL = 'https://www.du.edu/calendar';
const COURSE_OUTPUT_FILE = 'results/bulletin.json';
const ATHLETICS_OUTPUT_FILE = 'results/athletic_events.json';
const CALENDER_OUTPUT_FILE = 'results/calender_events.json';


//part one scrape DU bulletin
async function scrapeCourses() {
    try {
        const { data } = await axios.get(COURSE_URL);
        const $ = cheerio.load(data);
        const courses = [];

        $('div.courseblock').each((_, element) => {
            const courseInfo = $(element).find('.courseblocktitle strong').text().trim();
            const courseCodeMatch = courseInfo.match(/COMP\s*(\d{4})/);
            const courseCode = courseCodeMatch ? `COMP ${courseCodeMatch[1]}` : '';
            const courseTitle = courseInfo.replace(courseCode, '').trim();
            const description = $(element).find('.courseblockdesc').text().trim();

            if (/COMP 3\d{3}/.test(courseCode) && !description.includes('Prerequisite: ') && !description.includes('Prerequisites: ')) {
                courses.push({ course: courseCode, title: courseTitle });
            }
        });

        await fs.ensureDir('results');
        await fs.writeJson(COURSE_OUTPUT_FILE, { courses }, { spaces: 2 });

        console.log(`Scraped ${courses.length} courses and saved to ${COURSE_OUTPUT_FILE}`);
    } catch (error) {
        console.error('Error scraping courses:', error);
    }
}

scrapeCourses();

//part two scrape DU athletics page
// Helper: Extract a balanced JSON object from a string, starting at a given index.
function extractJSONObject(str, startIndex) {
    let stack = [];
    let inString = false;
    let stringChar = null;
    let escape = false;
    
    for (let i = startIndex; i < str.length; i++) {
      const char = str[i];
      
      if (inString) {
        if (escape) {
          escape = false;
        } else if (char === '\\') {
          escape = true;
        } else if (char === stringChar) {
          inString = false;
        }
      } else {
        if (char === '"' || char === "'") {
          inString = true;
          stringChar = char;
        } else if (char === '{') {
          stack.push('{');
        } else if (char === '}') {
          stack.pop();
          if (stack.length === 0) {
            return str.substring(startIndex, i + 1);
          }
        }
      }
    }
    return null;
  }

  
  axios.get(ATHLETICS_URL)
      .then(async response => {
      const html = response.data;
      const $ = cheerio.load(html);
      
      // Instead of selecting the first script with "var obj =", filter for one that includes '"type":"events"'
      let scriptContent;
      $('script').each((i, el) => {
        const content = $(el).html();
        if (content && content.includes('var obj =') && content.includes('"type":"events"')) {
          scriptContent = content;
          return false; // break out once found
        }
      });
      
      if (!scriptContent) {
        throw new Error('Script containing event data not found.');
      }
      
      // Find the position of "var obj =" and then the first "{" after it.
      const varObjIndex = scriptContent.indexOf("var obj =");
      if (varObjIndex === -1) {
        throw new Error('Could not find "var obj =" in the script.');
      }
      
      const jsonStart = scriptContent.indexOf("{", varObjIndex);
      if (jsonStart === -1) {
        throw new Error('Could not find the beginning of the JSON object.');
      }
      
      // Extract the balanced JSON portion.
      const jsonStr = extractJSONObject(scriptContent, jsonStart);
      if (!jsonStr) {
        throw new Error('Failed to extract a balanced JSON object.');
      }
      
      let dataObj;
      try {
        dataObj = JSON.parse(jsonStr);
      } catch (error) {
        console.error("Extracted JSON (first 1000 chars):", jsonStr.substring(0, 1000));
        throw new Error('Failed to parse JSON: ' + error.message);
      }
      
      // Extract events from the "data" property.
      const events = dataObj.data.map(event => {
        const eventDate = event.date || "";
        const opponent = event.opponent && event.opponent.name ? event.opponent.name : "";
        let duTeam = "";
        if (event.result && event.result.line_scores) {
          const ls = event.result.line_scores;
          if (ls.home_full_name && ls.home_full_name.toLowerCase().includes('denver')) {
            duTeam = ls.home_full_name;
          } else if (ls.away_full_name && ls.away_full_name.toLowerCase().includes('denver')) {
            duTeam = ls.away_full_name;
          }
        }
        if (!duTeam) {
          duTeam = "University of Denver";
        }
        return { duTeam, opponent, date: eventDate };
      });
      
      const finalResults = { events };
      
      try {
        await fs.ensureDir(RESULTS_DIR);
        await fs.writeJson(ATHLETICS_OUTPUT_FILE, { events }, { spaces: 2 });

        console.log(`Scraped ${events.length} events and saved to ${ATHLETICS_OUTPUT_FILE}`);
    } catch (error) {
        console.error('Error saving events:', error);
    }
    })


//part three scrape DU calender page
async function scrapeDUCalendar() {
    try {
        const { data } = await axios.get(CAL_URL);
        const $ = cheerio.load(data);
        const calendar_events = [];

        // Function to scrape events from a given page URL
        async function scrapeEventsFromPage(CAL_URL) {
            const { data } = await axios.get(CAL_URL);
            const $ = cheerio.load(data);

            $(".events-listing__item").each((index, element) => {
                const title = $(element).find("h3").text().trim();
                const date = $(element).find("p").first().text().trim();
                const timeElement = $(element).find("p:has(.icon-du-clock)");
                const time = timeElement.length ? timeElement.text().replace(/.*icon-du-clock\s*/, "").trim() : null;
                const eventPageUrl = $(element).find("a.event-card").attr("href");

                if (eventPageUrl) {
                    const fullEventUrl = new URL(eventPageUrl, CAL_URL).href;
                    calendar_events.push({ title, date, ...(time && { time }), url: fullEventUrl });
                }
            });

            // Check if there is a "Next" button to go to the next page
            const nextPageUrl = $(".icon-du-right-arrow").attr("href");
            if (nextPageUrl) {
                await scrapeEventsFromPage(new URL(nextPageUrl, CAL_URL).href);
            }
        }

        // Start scraping from the initial page
        await scrapeEventsFromPage(CAL_URL);

        await fs.ensureDir('results');
        await fs.writeJson(CALENDER_OUTPUT_FILE, { calendar_events }, { spaces: 2 });

        console.log(`Scraped ${calendar_events.length} Calendar events and saved to ${CALENDER_OUTPUT_FILE}`);
    } catch (error) {
        console.error('Error scraping calendar events:', error);
    }
}

scrapeDUCalendar();
