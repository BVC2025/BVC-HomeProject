import{o as e}from"./rolldown-runtime-DAXXjFlN.js";import{D as t,S as n,p as r,w as i}from"./index-BAt_ptBI.js";import{t as a}from"./RichTextEditor-BghCnhjh.js";var o=e(t(),1),s=1,c={getAll:()=>n.get(`/email-templates?vendor_id=${s}`),getByType:e=>n.get(`/email-templates/${e}?vendor_id=${s}`),update:(e,t)=>n.put(`/email-templates/${e}?vendor_id=${s}`,t),preview:e=>n.post(`/email-templates/preview?vendor_id=${s}`,e)},l={page:`_page_1jqhz_7`,topBar:`_topBar_1jqhz_25`,topLeft:`_topLeft_1jqhz_49`,title:`_title_1jqhz_57`,subtitle:`_subtitle_1jqhz_71`,topRight:`_topRight_1jqhz_83`,topField:`_topField_1jqhz_99`,topLabel:`_topLabel_1jqhz_113`,topSelect:`_topSelect_1jqhz_129`,saveBtn:`_saveBtn_1jqhz_179`,splitPane:`_splitPane_1jqhz_227`,editorPanel:`_editorPanel_1jqhz_243`,editorInner:`_editorInner_1jqhz_255`,loadingMsg:`_loadingMsg_1jqhz_269`,section:`_section_1jqhz_289`,sectionLabel:`_sectionLabel_1jqhz_305`,hint:`_hint_1jqhz_321`,code:`_code_1jqhz_333`,textInput:`_textInput_1jqhz_355`,textarea:`_textarea_1jqhz_401`,logoRow:`_logoRow_1jqhz_453`,logoEmpty:`_logoEmpty_1jqhz_467`,logoPreviewBox:`_logoPreviewBox_1jqhz_485`,logoThumb:`_logoThumb_1jqhz_505`,removeLogoBtn:`_removeLogoBtn_1jqhz_519`,hiddenInput:`_hiddenInput_1jqhz_565`,uploadBtn:`_uploadBtn_1jqhz_573`,previewPanel:`_previewPanel_1jqhz_613`,previewTopBar:`_previewTopBar_1jqhz_627`,previewLabel:`_previewLabel_1jqhz_649`,previewNote:`_previewNote_1jqhz_665`,previewFrame:`_previewFrame_1jqhz_677`,ddTrigger:`_ddTrigger_1jqhz_697`,ddTriggerOpen:`_ddTriggerOpen_1jqhz_743`,ddTriggerText:`_ddTriggerText_1jqhz_765`,ddChevron:`_ddChevron_1jqhz_781`,ddPanel:`_ddPanel_1jqhz_795`,ddSearchWrap:`_ddSearchWrap_1jqhz_825`,ddSearchIcon:`_ddSearchIcon_1jqhz_841`,ddSearchInput:`_ddSearchInput_1jqhz_851`,ddList:`_ddList_1jqhz_901`,ddEmpty:`_ddEmpty_1jqhz_915`,ddItem:`_ddItem_1jqhz_933`,ddItemActive:`_ddItemActive_1jqhz_957`,ddItemRow:`_ddItemRow_1jqhz_975`,ddItemName:`_ddItemName_1jqhz_993`,ddItemBadge:`_ddItemBadge_1jqhz_1017`,ddItemType:`_ddItemType_1jqhz_1043`,ddItemSubject:`_ddItemSubject_1jqhz_1061`},u=i(),d={company_name:`Your Company Name`,invited_company:`Acme Suppliers Pvt. Ltd.`,registration_link:`#preview-register`,expires_at:`31 December 2025`,support_email:`support@company.com`,company_address:`123 Business Park, Chennai, Tamil Nadu 600001`,contact_number:`+91 98765 43210`,website:`www.company.com`},f=Object.fromEntries(Object.keys(d).map(e=>[e,`{{${e}}}`])),p={logoDataUrl:``,headerTitle:`Supplier Management Portal`,contentHtml:[`<p>Dear <strong>{{invited_company}}</strong>,</p>`,`<p>We are pleased to invite you to register as an approved supplier on our `,`procurement platform. Please click the button below to complete your supplier `,`profile and begin the onboarding process.</p>`,`<p>If you have any questions at any stage of the registration process, do not `,`hesitate to reach out to our team — we are happy to assist.</p>`].join(``),customNotes:``};function m(e,t,n=`SUPPLIER_INVITATION`){let{logoDataUrl:r,headerTitle:i,contentHtml:a,customNotes:o}=e,{company_name:s,registration_link:c,expires_at:l,support_email:u,company_address:d,contact_number:f,website:p}=t,m=!n||n===`SUPPLIER_INVITATION`,h=r?`<img src="${r}" alt="Company Logo"
            style="max-height:60px;max-width:180px;display:block;margin:0 auto 14px;
                   object-fit:contain;">`:``,g=i?`<p style="color:rgba(255,255,255,0.82);margin:10px 0 0;font-size:12px;
                 letter-spacing:0.8px;text-transform:uppercase;">${i}</p>`:``,_=o?`<p style="color:#94a3b8;font-size:12px;font-style:italic;margin:20px 0 0;
                 padding-top:16px;border-top:1px solid #f1f5f9;">${o}</p>`:``,v=p.startsWith(`http`)?p:`https://${p}`;return`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Supplier Invitation</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
         style="background:#f8fafc;padding:40px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" role="presentation"
             style="background:#ffffff;border-radius:10px;overflow:hidden;
                    box-shadow:0 4px 16px rgba(0,0,0,0.08);max-width:600px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:#DC2626;padding:32px 48px;text-align:center;">
            ${h}
            <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:700;
                       letter-spacing:-0.3px;">${s}</h1>
            ${g}
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px 48px;font-family:Arial,Helvetica,sans-serif;
                     font-size:15px;line-height:1.75;color:#475569;">
            ${a||``}

            ${m?`<!-- CTA Button -->
            <table cellpadding="0" cellspacing="0" role="presentation"
                   style="margin:28px 0 20px;">
              <tr>
                <td style="background:#DC2626;border-radius:7px;">
                  <a href="${c}"
                     style="display:inline-block;padding:14px 32px;color:#ffffff;
                            text-decoration:none;font-weight:700;font-size:15px;
                            letter-spacing:0.2px;">
                    Complete Registration &rarr;
                  </a>
                </td>
              </tr>
            </table>

            <p style="color:#64748b;font-size:13px;line-height:1.65;margin:0 0 8px;">
              This invitation expires on <strong>${l}</strong>.
            </p>`:``}
            <p style="color:#64748b;font-size:13px;line-height:1.65;margin:0;">
              Questions? Contact us at
              <a href="mailto:${u}"
                 style="color:#DC2626;text-decoration:none;">${u}</a>.
            </p>
            ${_}
          </td>
        </tr>

        <!-- Divider -->
        <tr>
          <td style="padding:0 48px;">
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0;">
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:24px 48px;background:#f8fafc;text-align:center;">
            <p style="color:#94a3b8;font-size:12px;line-height:2;margin:0;">
              <strong style="color:#64748b;">${s}</strong><br>
              ${d}<br>
              Phone:&nbsp;${f}&nbsp;|&nbsp;
              <a href="${v}"
                 style="color:#DC2626;text-decoration:none;">${p}</a><br>
              <a href="mailto:${u}"
                 style="color:#DC2626;text-decoration:none;">${u}</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`}function h(e){if(!e)return{...p};try{let t=JSON.parse(e);if(t&&t.version===1)return{logoDataUrl:t.logoDataUrl??``,headerTitle:t.headerTitle??p.headerTitle,contentHtml:t.contentHtml??p.contentHtml,customNotes:t.customNotes??``}}catch{}return{...p}}function g(){let e=r(),[t,n]=(0,o.useState)([]),[i,s]=(0,o.useState)(``),[g,_]=(0,o.useState)(``),[v,y]=(0,o.useState)({...p}),[b,x]=(0,o.useState)(!1),[S,C]=(0,o.useState)(!0),[w,T]=(0,o.useState)(!1),[E,D]=(0,o.useState)(``),[O,k]=(0,o.useState)(0),[A,j]=(0,o.useState)(!1),[M,N]=(0,o.useState)(``),P=(0,o.useRef)(!1),F=(0,o.useRef)(null),I=(0,o.useRef)(null),L=(0,o.useRef)(null),R=(0,o.useRef)(g),z=(0,o.useRef)(i);(0,o.useEffect)(()=>{R.current=g},[g]),(0,o.useEffect)(()=>{z.current=i},[i]),(0,o.useEffect)(()=>{P.current||(P.current=!0,c.getAll().then(e=>{let t=e.data||[];n(t),t.length>0&&s(t[0].TEMPLATE_TYPE)}).catch(()=>e.showError(`Failed to load email templates`)).finally(()=>C(!1)))},[]),(0,o.useEffect)(()=>{i&&(T(!0),c.getByType(i).then(e=>{let t=e.data;_(t.SUBJECT||``),y(h(t.DESIGN_JSON)),k(e=>e+1)}).catch(()=>e.showError(`Failed to load template`)).finally(()=>T(!1)))},[i]),(0,o.useEffect)(()=>(clearTimeout(F.current),F.current=setTimeout(()=>{D(m(v,d,z.current))},350),()=>clearTimeout(F.current)),[v]),(0,o.useEffect)(()=>{if(!A)return;let e=e=>{L.current&&!L.current.contains(e.target)&&(j(!1),N(``))};return document.addEventListener(`mousedown`,e),()=>document.removeEventListener(`mousedown`,e)},[A]);let B=(0,o.useCallback)(e=>{s(e),j(!1),N(``)},[]),V=(0,o.useCallback)(e=>{_(e.target.value)},[]),H=(0,o.useCallback)(e=>{y(t=>({...t,headerTitle:e.target.value}))},[]),U=(0,o.useCallback)(e=>{y(t=>({...t,customNotes:e.target.value}))},[]),W=(0,o.useCallback)(e=>{y(t=>({...t,contentHtml:e}))},[]),G=(0,o.useCallback)(t=>{let n=t.target.files?.[0];if(!n)return;if(!n.type.startsWith(`image/`)){e.showError(`Please select an image file (PNG, JPG, SVG)`),t.target.value=``;return}if(n.size>512*1024){e.showError(`Logo file must be under 512 KB`),t.target.value=``;return}let r=new FileReader;r.onload=e=>y(t=>({...t,logoDataUrl:e.target.result})),r.readAsDataURL(n),t.target.value=``},[e]),K=(0,o.useCallback)(()=>{y(e=>({...e,logoDataUrl:``}))},[]),q=(0,o.useCallback)(async()=>{if(!(!i||b)){x(!0);try{let t=m(v,f,i),n=JSON.stringify({version:1,...v});await c.update(i,{SUBJECT:R.current,BODY_HTML:t,DESIGN_JSON:n}),e.showSuccess(`Template saved. Future emails will use this updated version.`)}catch{e.showError(`Failed to save template — please try again.`)}finally{x(!1)}}},[i,v,b,e]),J=(0,o.useMemo)(()=>t.find(e=>e.TEMPLATE_TYPE===i)||null,[t,i]),Y=(0,o.useMemo)(()=>{if(!M.trim())return t;let e=M.toLowerCase();return t.filter(t=>t.DISPLAY_NAME.toLowerCase().includes(e)||t.TEMPLATE_TYPE.toLowerCase().includes(e)||(t.SUBJECT||``).toLowerCase().includes(e))},[t,M]),X=!b&&!w&&!!i;return(0,u.jsxs)(`div`,{className:l.page,children:[(0,u.jsxs)(`div`,{className:l.topBar,children:[(0,u.jsxs)(`div`,{className:l.topLeft,children:[(0,u.jsx)(`h2`,{className:l.title,children:`Email Template Editor`}),(0,u.jsx)(`p`,{className:l.subtitle,children:`Edit the template content, logo, and subject line. Changes apply automatically to all future outgoing emails.`})]}),(0,u.jsxs)(`div`,{className:l.topRight,children:[(0,u.jsxs)(`div`,{className:l.topField,ref:L,children:[(0,u.jsx)(`label`,{className:l.topLabel,children:`Template`}),(0,u.jsxs)(`button`,{type:`button`,className:`${l.ddTrigger} ${A?l.ddTriggerOpen:``}`,onClick:()=>!S&&j(e=>!e),disabled:S,children:[(0,u.jsx)(`span`,{className:l.ddTriggerText,children:S?`Loading…`:J?.DISPLAY_NAME||`Select a template`}),(0,u.jsx)(`svg`,{className:l.ddChevron,style:{transform:A?`rotate(180deg)`:`rotate(0deg)`},width:`12`,height:`12`,viewBox:`0 0 12 12`,fill:`none`,children:(0,u.jsx)(`path`,{d:`M2 4l4 4 4-4`,stroke:`currentColor`,strokeWidth:`1.8`,strokeLinecap:`round`,strokeLinejoin:`round`})})]}),A&&(0,u.jsxs)(`div`,{className:l.ddPanel,children:[(0,u.jsxs)(`div`,{className:l.ddSearchWrap,children:[(0,u.jsxs)(`svg`,{className:l.ddSearchIcon,width:`14`,height:`14`,viewBox:`0 0 24 24`,fill:`none`,stroke:`currentColor`,strokeWidth:`2`,strokeLinecap:`round`,children:[(0,u.jsx)(`circle`,{cx:`11`,cy:`11`,r:`7`}),(0,u.jsx)(`path`,{d:`M21 21l-4.35-4.35`})]}),(0,u.jsx)(`input`,{type:`text`,className:l.ddSearchInput,placeholder:`Search templates…`,value:M,onChange:e=>N(e.target.value),autoFocus:!0})]}),(0,u.jsx)(`div`,{className:l.ddList,children:Y.length===0?(0,u.jsx)(`div`,{className:l.ddEmpty,children:`No templates match`}):Y.map(e=>{let t=e.TEMPLATE_TYPE===i;return(0,u.jsxs)(`div`,{className:`${l.ddItem} ${t?l.ddItemActive:``}`,onClick:()=>B(e.TEMPLATE_TYPE),children:[(0,u.jsxs)(`div`,{className:l.ddItemRow,children:[(0,u.jsx)(`span`,{className:l.ddItemName,children:e.DISPLAY_NAME}),t&&(0,u.jsx)(`span`,{className:l.ddItemBadge,children:`Active`})]}),(0,u.jsx)(`div`,{className:l.ddItemType,children:e.TEMPLATE_TYPE}),e.SUBJECT&&(0,u.jsx)(`div`,{className:l.ddItemSubject,title:e.SUBJECT,children:e.SUBJECT})]},e.TEMPLATE_TYPE)})})]})]}),(0,u.jsx)(`button`,{className:l.saveBtn,onClick:q,disabled:!X,children:b?`Saving…`:`Save Template`})]})]}),(0,u.jsxs)(`div`,{className:l.splitPane,children:[(0,u.jsx)(`div`,{className:l.editorPanel,children:w?(0,u.jsx)(`div`,{className:l.loadingMsg,children:`Loading template…`}):(0,u.jsxs)(`div`,{className:l.editorInner,children:[(0,u.jsxs)(`div`,{className:l.section,children:[(0,u.jsx)(`label`,{className:l.sectionLabel,htmlFor:`tmpl-subject`,children:`Subject Line`}),(0,u.jsx)(`input`,{id:`tmpl-subject`,type:`text`,className:l.textInput,value:g,onChange:V,placeholder:`e.g. You're invited to register as a supplier`})]}),(0,u.jsxs)(`div`,{className:l.section,children:[(0,u.jsxs)(`label`,{className:l.sectionLabel,children:[`Company Logo`,(0,u.jsx)(`span`,{className:l.hint,children:`\xA0· PNG, JPG or SVG, max 512 KB`})]}),(0,u.jsxs)(`div`,{className:l.logoRow,children:[v.logoDataUrl?(0,u.jsxs)(`div`,{className:l.logoPreviewBox,children:[(0,u.jsx)(`img`,{src:v.logoDataUrl,alt:`Logo preview`,className:l.logoThumb}),(0,u.jsx)(`button`,{type:`button`,className:l.removeLogoBtn,onClick:K,title:`Remove logo`,children:`×`})]}):(0,u.jsx)(`div`,{className:l.logoEmpty,children:`No logo uploaded`}),(0,u.jsx)(`input`,{ref:I,type:`file`,accept:`image/png,image/jpeg,image/jpg,image/svg+xml,image/webp`,className:l.hiddenInput,onChange:G}),(0,u.jsx)(`button`,{type:`button`,className:l.uploadBtn,onClick:()=>I.current?.click(),children:v.logoDataUrl?`Replace Logo`:`Upload Logo`})]})]}),(0,u.jsxs)(`div`,{className:l.section,children:[(0,u.jsxs)(`label`,{className:l.sectionLabel,htmlFor:`tmpl-header`,children:[`Header Subtitle`,(0,u.jsx)(`span`,{className:l.hint,children:`\xA0· Shown below the company name in the red banner`})]}),(0,u.jsx)(`input`,{id:`tmpl-header`,type:`text`,className:l.textInput,value:v.headerTitle,onChange:H,placeholder:`e.g. Supplier Management Portal`})]}),(0,u.jsxs)(`div`,{className:l.section,children:[(0,u.jsxs)(`label`,{className:l.sectionLabel,children:[`Email Body Content`,(0,u.jsxs)(`span`,{className:l.hint,children:[`\xA0· Use`,` `,(0,u.jsx)(`code`,{className:l.code,children:`{{invited_company}}`}),` `,`as a placeholder for the supplier name`]})]}),(0,u.jsx)(a,{initialValue:v.contentHtml,onChange:W},O)]}),(0,u.jsxs)(`div`,{className:l.section,children:[(0,u.jsxs)(`label`,{className:l.sectionLabel,htmlFor:`tmpl-notes`,children:[`Custom Notes`,(0,u.jsx)(`span`,{className:l.hint,children:`\xA0· Optional — shown in small italic text below the CTA button`})]}),(0,u.jsx)(`textarea`,{id:`tmpl-notes`,className:l.textarea,value:v.customNotes,onChange:U,placeholder:`e.g. Please complete registration within the specified time frame.`,rows:3})]})]})}),(0,u.jsxs)(`div`,{className:l.previewPanel,children:[(0,u.jsxs)(`div`,{className:l.previewTopBar,children:[(0,u.jsx)(`span`,{className:l.previewLabel,children:`Live Preview`}),(0,u.jsx)(`span`,{className:l.previewNote,children:`Showing sample data — actual company details fill in when email is sent`})]}),(0,u.jsx)(`iframe`,{title:`Email Preview`,className:l.previewFrame,srcDoc:E,sandbox:`allow-same-origin`})]})]})]})}export{g as default};