import express from 'express';
import cors from 'cors';
import { Builder, By, until, Key } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });

const app = express();
app.use(cors());

// Helper function to chunk HTML
function chunkHtml(html, chunkSize = 20000) {
  const chunks = [];
  for (let i = 0; i < html.length; i += chunkSize) {
    chunks.push(html.slice(i, i + chunkSize));
  }
  return chunks;
}

// Helper function to filter chunks containing reviews
function filterChunksWithReviews(chunks) {
  return chunks.filter((chunk) => chunk.toLowerCase().includes('rating'));
}

// Helper function to log review details
function logReviewDetails(reviews) {
  console.log('\n=== Review Details ===\n');
  reviews.forEach((review, index) => {
    console.log(`Review #${index + 1}`);
    console.log('Reviewer:', review.reviewer);
    console.log('Rating:', '⭐'.repeat(Math.min(review.rating, 5)));
    console.log('Date:', review.date);
    console.log('Review:', review.body);
    console.log('-------------------\n');
  });
  console.log(`Total Reviews: ${reviews.length}\n`);
}

// Process HTML chunks to extract selectors
async function extractSelectors(reviewChunks) {
  let selectors = {};
  let selectorsFound = false;

  for (let i = 0; i < reviewChunks.length; i++) {
    if (selectorsFound) {
      console.log('All selectors found. Skipping remaining chunks.');
      break;
    }

    console.log(`Processing chunk ${i + 1} of ${reviewChunks.length}`);
    const prompt = `
      Analyze this HTML chunk and identify CSS selectors for review elements. 
      Return the CSS selectors only when you find multiple reviews with the same CSS selecors and you're sure of it.
      Focus on the following:
      - container: The outer container of the review element.
      - name: The selector for the reviewer name.
      - rating: The selector for the rating element (do not select inner-most if not necessary).
      - review: The selector for the review text.
      - date: The selector for the review date (inner-most).
      - nextPageSelector: The selector for the next page button (usually within a link or button with "next" in the class or aria-label).

      Please ensure that the selectors are consistent across all chunks. Only return valid CSS selectors. Format:
      {
        "container": ".selector",
        "name": ".selector",
        "rating": ".selector",
        "review": ".selector",
        "date": ".selector",
        "nextPageSelector": ".selector"
      }
      HTML Chunk:
    ${reviewChunks[i]}
    `;

    try {
      const result = await model.generateContent(prompt, { temperature: 0 });
      const response = result.response.text().trim();

      if (response) {
        const jsonStr = response.replace(/```json\n?|\n?```/g, '').trim();
        console.log(`Model response for chunk ${i + 1}:`, jsonStr);

        try {
          const chunkSelectors = JSON.parse(jsonStr);

          if (chunkSelectors) {
            selectors = {
              container: chunkSelectors.container || selectors.container,
              name: chunkSelectors.name || selectors.name,
              rating: chunkSelectors.rating || selectors.rating,
              review: chunkSelectors.review || selectors.review,
              date: chunkSelectors.date || selectors.date,
              nextPageSelector: chunkSelectors.nextPageSelector || selectors.nextPageSelector,
            };
          }

          // Check if all selectors are populated
          selectorsFound = Object.values(selectors).every((selector) => !!selector);
          if (selectorsFound) {
            console.log('All required selectors found:', selectors);
          }
        } catch (parseError) {
          console.error('Error parsing JSON response:', parseError);
        }
      }
    } catch (error) {
      console.error(`Error processing chunk ${i + 1}:`, error);
    }
  }

  if (!selectorsFound) {
    console.warn('Failed to find all required selectors after processing all chunks.');
  }

  return selectors;
}

app.get('/api/reviews', async (req, res) => {
  const { url, numReviews = 5 } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  const options = new chrome.Options();
  options.addArguments(
    '--headless', 
    '--disable-gpu', 
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-logging', 
    '--mute-audio',
    '--disable-web-security',
    '--ignore-certificate-errors',
    '--allow-running-insecure-content'
  );

  // Disable specific Chrome logging
  options.setLoggingPrefs({
    browser: 'OFF',
    driver: 'OFF',
    performance: 'OFF'
  });

  const driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();

  let allReviews = [];
  let selectors = null;

  try {
    console.log(`Scraping reviews from ${url}, aiming for ${numReviews} reviews.`);

    await driver.get(url);
    await driver.wait(until.elementLocated(By.css('body')), 10000);

    // Scroll to reviews section
    await driver.executeScript(`
      const reviewsSection = document.querySelector('.reviews-section, #reviews, [data-section="reviews"]');
      if (reviewsSection) {
        reviewsSection.scrollIntoView({behavior: 'smooth', block: 'center'});
      }
    `);
    await driver.sleep(2000);

    // Try to click "Show More Reviews" or similar button if exists
    await driver.executeScript(`
      const showMoreButtons = [
        ...document.querySelectorAll('button')
      ].filter(btn => 
        btn.textContent.toLowerCase().includes('more reviews') || 
        btn.textContent.toLowerCase().includes('load more')
      );
      
      if (showMoreButtons.length > 0) {
        showMoreButtons[0].click();
      }
    `);
    await driver.sleep(2000);

    while (allReviews.length < numReviews) {
      const fullHtml = await driver.executeScript('return document.documentElement.outerHTML');

      // Extract selectors if not already done
      if (!selectors) {
        const htmlChunks = chunkHtml(fullHtml);
        const reviewChunks = filterChunksWithReviews(htmlChunks);        
        reviewChunks.reverse(); // Process chunks from the end
        selectors = await extractSelectors(reviewChunks);

        if (!selectors.container) {
          await driver.quit();
          return res.status(404).json({ error: 'Review selectors not found.' });
        }
        console.log('Extracted selectors:', selectors);
      }

      // Enhanced review extraction with fallback parsing
      const reviews = await driver.executeScript((selectors) => {
        const reviewElements = document.querySelectorAll(selectors.container);
        return Array.from(reviewElements).map((review) => {
          const nameElement = review.querySelector(selectors.name);
          const ratingElement = review.querySelector(selectors.rating);
          const reviewElement = review.querySelector(selectors.review);
          const dateElement = review.querySelector(selectors.date);

          // Multiple strategies to extract rating
          let rating = 0;
          if (ratingElement) {
            // Try aria-label
            const ariaLabel = ratingElement.getAttribute('aria-label');
            if (ariaLabel) {
              const match = ariaLabel.match(/(\d+)\s*star/i);
              if (match) rating = parseInt(match[1], 10);
            }
            
            // Try counting star elements
            if (rating === 0) {
              const starElements = ratingElement.querySelectorAll('.star, .rating-star, [data-star]');
              rating = starElements.length;
            }
            
            // Try parsing text content
            if (rating === 0) {
              const ratingText = ratingElement.textContent.trim();
              const match = ratingText.match(/(\d+(?:\.\d+)?)\s*\/?\s*5/);
              if (match) rating = Math.round(parseFloat(match[1]));
            }
          }

          return {
            title: nameElement?.textContent?.trim() || '',
            body: reviewElement?.textContent?.trim() || '',
            rating: rating,
            reviewer: nameElement?.textContent?.trim() || '',
            date: dateElement?.textContent?.trim() || '',
          };
        }).filter(review => review.body); // Only keep reviews with non-empty body
      }, selectors);

      allReviews = [...allReviews, ...reviews];

      // Check if we have collected enough reviews
      if (allReviews.length >= numReviews) {
        console.log('Collected required number of reviews.');
        break;
      }

      // Try multiple navigation strategies
      try {
        const navigationAttempts = [
          // Try next page button
          `document.querySelector('${selectors.nextPageSelector}')?.click()`,
          
          // Try other common pagination selectors
          `document.querySelector('.pagination .next')?.click()`,
          `document.querySelector('.reviews-pagination .next')?.click()`,
          
          // Scroll to bottom
          `window.scrollTo(0, document.body.scrollHeight);`
        ];

        for (const navScript of navigationAttempts) {
          await driver.executeScript(navScript);
          await driver.sleep(2000);
        }
      } catch (navError) {
        console.error('Navigation error:', navError);
        break;
      }

      // Break if no new reviews were found
      if (allReviews.length === 0) {
        console.log('No more reviews found.');
        break;
      }
    }

    const filteredReviews = allReviews.slice(0, numReviews).filter(review => review.body);

    logReviewDetails(filteredReviews);

    return res.json({
      reviews_numReviews: filteredReviews.length,
      reviews: filteredReviews,
    });
  } catch (error) {
    console.error('Exception occurred:', error);
    return res.status(500).json({ error: 'An error occurred while processing reviews.' });
  } finally {
    await driver.quit();
  }
});

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.listen(process.env.PORT, () => {
  console.log('Server running on port 8000');
});
