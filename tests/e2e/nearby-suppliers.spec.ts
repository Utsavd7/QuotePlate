import { expect, test } from '@playwright/test';
import { resetSignupClientRateLimit } from './helpers/signup';
import { expectNoSeriousAxeViolations } from './helpers/accessibility';

// Only the public map-provider boundary is represented by a fixture. Authentication,
// review dialog, supplier persistence and subsequent workspace reload use the real app.
test('nearby lead requires explicit restaurant verification before saving', async ({ page }, info) => {
 await resetSignupClientRateLimit(page.request);
 const email=`nearby-${info.project.name}-${Date.now()}@example.com`;
 const created=await page.request.post('/api/auth/start',{data:{method:'email',restaurantName:'Nearby Test Kitchen',ownerName:'Asha Rao',email,password:'Local-only nearby password 42!',addressLine:'18 Market Road',city:'Pune',state:'Maharashtra',pin:'411001',phone:'+91 9876543210',timezone:'Asia/Kolkata'}});
 expect(created.status(),await created.text()).toBe(201);
 await page.goto('/signin');
 await page.getByLabel('Work email').fill(email);await page.getByLabel('Password').fill('Local-only nearby password 42!');
 await page.getByRole('button',{name:'Sign in with email'}).click();await expect(page).toHaveURL(/\/dashboard$/);
 const skip=page.getByRole('button',{name:'Skip for now'});if(await skip.isVisible())await skip.click();
 const center={id:'18.52,73.85',label:'Pune, Maharashtra, India',lat:18.52,lon:73.85};
 const source={id:'node/123',name:'Reviewed Map Produce',distanceKm:1.2,phone:'9876543210',website:null,address:'Market Road',city:'Pune',state:'Maharashtra',pin:'411001',category:'produce',kind:'Retail potential',sourceUrl:'https://www.openstreetmap.org/node/123',mapUrl:'https://www.openstreetmap.org/node/123',verificationStatus:'UNVERIFIED'};
 let externalSearches=0;
 await page.route('**/api/suppliers/discover',async route=>{
  if(route.request().method()==='GET')return route.continue();
  externalSearches++;
  const data=route.request().postDataJSON();
  return route.fulfill({json:data.centerId?{center,category:'produce',radius:2,results:[source],limited:false}:{centers:[center]}});
 });
 await page.goto('/suppliers');
 await page.locator('summary').filter({hasText:'Find nearby suppliers'}).click();
 await expect(page.getByLabel('Restaurant area in India')).toHaveValue(/Pune/);
 expect(externalSearches).toBe(0);
 await page.getByRole('button',{name:'Find my area',exact:true}).click();
 await expect(page.getByText('Search area:',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Find nearby suppliers',exact:true}).click();
 const results=page.getByRole('region',{name:'Nearby supplier results'});
 await expect(results.getByRole('heading',{name:source.name})).toBeVisible();
 await expect(results).toContainText('Unverified');
 const before=await page.request.get('/api/suppliers');expect(JSON.stringify(await before.json())).not.toContain(source.name);
 await results.getByRole('button',{name:`Review and add ${source.name}`}).click();
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
 await expect(dialog.getByLabel('Business name')).toHaveValue(source.name);await expect(dialog.getByLabel('Phone',{exact:true})).toHaveValue(source.phone);
 await expect(dialog.getByRole('button',{name:'Add supplier',exact:true})).toBeDisabled();
 await dialog.getByRole('checkbox',{name:'I have checked this supplier’s contact details and ability to supply our restaurant.'}).check();
 await expectNoSeriousAxeViolations(page,'[role="dialog"]');
 await dialog.getByRole('button',{name:'Add supplier',exact:true}).click();await expect(dialog).not.toBeVisible();
 const response=await page.request.get('/api/suppliers');const suppliers=await response.json();
 const saved=(Array.isArray(suppliers)?suppliers:suppliers.suppliers).find((s:{businessName:string})=>s.businessName===source.name);
 expect(saved).toMatchObject({businessName:source.name,verificationStatus:'VERIFIED'});
 await page.reload();
 const directory=page.getByRole('region',{name:'Supplier directory',exact:true});
 await expect(directory.getByText(source.name,{exact:true})).toBeVisible();
 await expect(directory.getByRole('button',{name:`Edit ${source.name}`,exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
});
