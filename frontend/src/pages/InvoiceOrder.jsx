import { useState } from "react";
import taxInvoice from "../services/taxInvoice";
import styles from "./InvoiceOrder.module.css";


const InvoiceOrder=()=>{


  const[data,setData]=useState({
    "CUSTOMER_ID":"",
    "TAX_ID":"",
    "IRN": "",
    "ACK_NO": "",
    "ACK_DATE":"",
    "INVOICE_NUMBER":"",
    "EWAY_BILL_NO": "",
    "DATED":"",
    "DELIVERY_NOTE": "",
    "MODERN_TERMS_OF_PAYMENT":"",
    "REFERENCE_No_DATE":"",
    "OTHER_REFERENCE":"",
    "BUYER_ORDER_NUMBER": "",
    "DISPATCH_DOC_NUMBER": "",
    "DELIVERY_NOTE_DATE":"",
    "DISPATCHED_THROUGH": "",
    "DESTINATION": "",
    "BILL_OF_LANDING": "",
    "LR_RR_NO": "",
    "MOTOR_VEHICLE_NUMBER":"",
    "TERMS_OF_DELIVERY": "",
    "HOME_ADDRESS": "",
    "SHIP_TO": "",
    "BILL_TO": "",
    "DESCRIPTION": "",
    "HSN": "",
    "TOTAL_QTY": "",
    "TOTAL_AMOUNT": "",
    "TOTAL_AMOUNT_IN_WORDS": "",
    "TOTAL_GST_PERCENT": "",
    "CGST": "",
    "SGST": "",
    "TAX_AMOUNT": "",
    "TAX_AMOUNT_IN_WORDS": "",
    "DECLARATION":""
  })

  



}

export default InvoiceOrder; 