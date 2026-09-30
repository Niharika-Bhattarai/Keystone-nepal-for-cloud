'use strict';
const {chromium}=require('../frontend-keystone/node_modules/playwright');
const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
(async()=>{
  const browser=await chromium.launch({executablePath:edge,headless:true});
  const context=await browser.newContext();
  const errors=[],remote=[];
  context.on('page',page=>page.on('pageerror',e=>errors.push(e.message)));
  context.on('request',request=>{
    const url=request.url();
    if(/^https?:\/\//.test(url)&&!/^http:\/\/127\.0\.0\.1:(5299|8299)\//.test(url))remote.push(url);
  });
  try{
    const page=await context.newPage();
    await page.goto('http://127.0.0.1:5299/');
    await page.getByRole('button',{name:/Design my house/i}).first().click();
    await page.getByText('Nepal site brief').waitFor();
    await page.evaluate(()=>localStorage.removeItem('keystone-nepal:brief-v1'));
    await page.getByLabel('Ward',{exact:true}).fill('10');
    await page.getByLabel('Source of north bearing',{exact:true}).fill('survey drawing');
    await page.getByRole('button',{name:'Check Nepal brief'}).click();
    await page.getByText('Survey inputs complete').waitFor();
    const [popup]=await Promise.all([
      page.waitForEvent('popup'),
      page.getByRole('button',{name:'Open working plan review'}).click()
    ]);
    await popup.waitForURL(url=>url.protocol==='blob:');
    await popup.getByText('Keystone Nepal · spatial review plans').waitFor();
    const options=await popup.locator('section.option').count();
    const plans=await popup.locator('article.floor svg').count();
    console.log(JSON.stringify({previewOpened:true,options,plans,errors,remoteRequests:remote}));
    if(options===0||plans===0||errors.length||remote.length)process.exitCode=1;
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
