#!/usr/bin/env node
require('dotenv').config();

const readline = require('node:readline');
const { runApply } = require('../src/apply');

function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--job=')) args.jobId = arg.split('=')[1];
    if (arg.startsWith('--user=')) args.userId = arg.split('=')[1];
    if (arg === '--headless') args.headless = true;
    if (arg === '--headed') args.headless = false;
  }
  return args;
}

function formatTime() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

async function main() {
  const args = parseArgs(process.argv);
  console.log(`\n============================================================`);
  console.log(`🚀 Oracle Cloud HCM Live Application Runner`);
  console.log(`Pacing: Human-speed keystrokes & deliberate action pauses`);
  console.log(`Safety: HARD NO-SUBMIT GATE ACTIVE (Stops at Review screen)`);
  console.log(`============================================================\n`);

  let finalResult = null;

  try {
    finalResult = await runApply({
      jobId: args.jobId,
      userId: args.userId || 'default_user',
      headless: args.headless,
      onProgress: (evt) => {
        const time = formatTime();
        if (evt.step === 'init') {
          console.log(`[${time}] 📋 Target: ${evt.company} - ${evt.title}`);
        } else if (evt.step === 'login') {
          console.log(`[${time}] 🔑 Auth: ${evt.message || evt.status}`);
        } else if (evt.step === 'page_fill') {
          console.log(`[${time}] 📄 Page ${evt.page}: Filling fields...`);
        } else if (evt.step === 'field_fill') {
          const valPreview = typeof evt.value === 'object' ? JSON.stringify(evt.value) : String(evt.value);
          console.log(`  [${time}]  ↳ Filled ${evt.field_id} = "${valPreview.slice(0, 40)}"`);
        } else if (evt.step === 'review_ready' || evt.step === 'halted_at_review') {
          console.log(`\n[${time}] 🛑 REVIEW SCREEN REACHED: Submit button is visible.`);
          if (evt.reviewScreenshot) {
            console.log(`  ↳ Review screenshot: ${evt.reviewScreenshot}`);
          }
        }
      },
    });

    console.log(`\n============================================================`);
    if (finalResult.status === 'filled_awaiting_approval') {
      console.log(`✅ SUCCESS: All fields filled accurately across all pages!`);
      console.log(`📸 Review screenshot: ${finalResult.reviewScreenshot}`);
      console.log(`🛡️  Gating: Submit button was NOT clicked (Hard Rule #1 enforced).`);
      console.log(`============================================================\n`);

      if (finalResult.browser && !args.headless) {
        console.log(`Browser is open for your inspection.`);
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        await new Promise((resolve) => {
          rl.question('Press ENTER to close the browser and exit: ', () => {
            rl.close();
            resolve();
          });
        });
        await finalResult.browser.close().catch(() => {});
      }
    } else if (finalResult.status === 'validation_error') {
      console.log(`\n❌ Validation Error on page ${finalResult.page}:`);
      (finalResult.errors || []).forEach((err) => console.log(`   ↳ ${err}`));
      if (finalResult.errorScreenshot) {
        console.log(`   📸 Screenshot: ${finalResult.errorScreenshot}`);
      }
      if (finalResult.browser && !args.headless) {
        console.log(`\nBrowser is open for your inspection.`);
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        await new Promise((resolve) => {
          rl.question('Press ENTER to close the browser and exit: ', () => {
            rl.close();
            resolve();
          });
        });
        await finalResult.browser.close().catch(() => {});
      }
    } else {
      console.log(`Outcome status: ${finalResult.status}`);
      if (finalResult.browser) await finalResult.browser.close().catch(() => {});
    }
  } catch (err) {
    console.error(`\n❌ Live apply runner failed: ${err.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
