import { renderToStaticMarkup } from 'react-dom/server';
import { SupplierPortalContent } from '@/components/supplier-portal/SupplierPortalContent';
import type { SupplierPortalView } from '@/lib/supplier-portal/types';
const view: SupplierPortalView = {
 portalId: 'portal-greenleaf', restaurantName: 'Monsoon Table', supplierName: 'GreenLeaf', expiresAt: '2026-09-30T00:00:00Z',
 forecasts: [{id:'f',planId:'p',planVersion:1,serviceAt:'2026-09-12T12:00:00Z',sharedAt:'2026-09-07T10:00:00Z',stale:true,items:[{itemKey:'tomato',name:'Tomato',quantity:'7.5',unit:'KILOGRAM',specification:'Fresh'}]}],
 orders:[{requestId:'r',title:'Dinner supplies',deliveryDate:'2026-09-12',status:'selected',version:1,items:[{itemId:'tomato',name:'Tomato',quantity:'10',unit:'KILOGRAM'}],acknowledgement:null,delivery:null,response:null,responseIsCurrent:false}]
};
const html = (data=view) => renderToStaticMarkup(<SupplierPortalContent view={data} busy={false} onSubmit={async()=>{}} />);
it('shows supplier quantities, acknowledgement and explicitly non-binding stale demand',()=>{
 const output=html();
 expect(output).toContain('Confirm order');
 expect(output).toContain('10');
 expect(output).toContain('Estimate only');
 expect(output).toContain('Outdated');
 expect(output).toContain('7.5');
 expect(output).not.toContain('Agree with delivery');
});
it('does not offer acknowledgement for a closed order',()=>{
 const output=html({...view,orders:[{...view.orders[0],status:'closed'}]});
 expect(output).toContain('Closed');
 expect(output).not.toContain('Confirm order');
});
it('labels prior feedback as outdated after the restaurant changes its record',()=>{
 const order={...view.orders[0],delivery:{fingerprint:'new',checkedAt:'2026-09-12T12:00:00Z',status:'PARTIAL',lines:[],credit:{claimedPaise:'500000',receivedPaise:'200000',outstandingPaise:'300000'},notes:'Missing quantity'},response:{decision:'agree' as const,note:'',evidenceReference:'CN-1',at:'2026-09-12T11:00:00Z',fingerprint:'old'},responseIsCurrent:false};
 const output=html({...view,orders:[order]});
 expect(output).toContain('Delivery record changed');
 expect(output).toContain('Agree with delivery');
 expect(output).toContain('Evidence reference');
 expect(output).toContain('recorded');
});

it('makes the invoice and issue facts visible before supplier agreement',()=>{
 const order={...view.orders[0],delivery:{fingerprint:'f',checkedAt:'2026-09-12T12:00:00Z',status:'ISSUES',invoiceTotalPaise:'120000',expectedTotalPaise:'100000',issueCodes:['PRICE_DIFFERENCE'],actualDeliveryDate:'2026-09-12',settlementNote:'CN-44 pending',lines:[],credit:{claimedPaise:'20000',receivedPaise:'0',outstandingPaise:'20000'},notes:''}};
 const output=html({...view,orders:[order]});
 expect(output).toContain('Invoice recorded');
 expect(output).toContain('₹1,200.00');
 expect(output).toContain('₹1,000.00');
 expect(output).toContain('Price difference');
 expect(output).toContain('CN-44 pending');
});

it('brings business confirmation forward while keeping order responses and history available', () => {
 const output = html({...view, orders: [{...view.orders[0], requestId:'old', title:'Old completed request', status:'closed'}, view.orders[0]]});
 expect(output.indexOf('Confirm your business details')).toBeLessThan(output.indexOf('Needs your response'));
 expect(output.indexOf('Needs your response')).toBeLessThan(output.indexOf('Dinner supplies'));
 expect(output.indexOf('Dinner supplies')).toBeLessThan(output.indexOf('Old completed request'));
 expect(output).toContain('href="#supplier-orders-title"');
 expect(output).toContain('Go to orders and quotes');
 expect(output).toContain('Confirm order');
 expect(output).toContain('aria-label="Edit trading profile" hidden=""');
 expect(output).not.toContain('Your business details (optional)');
});

it('prefills only this supplier’s provided contacts and leaves orders usable before confirmation', () => {
 const output = html({ ...view, businessDetails: { contactName: 'Asha', phone: '+919111122222', whatsappNumber: null, email: null, categories: ['VEGETABLES'] } });
 expect(output).toContain('value="Asha"');
 expect(output).toContain('value="+919111122222"');
 expect(output).toContain('1 selected');
 expect(output).toContain('Confirmation needed');
 expect(output).toContain('Save order response');
});
