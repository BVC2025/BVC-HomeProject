import { useState } from "react"
import ewayBill from "../services/ewayBill"
import styles from "./EwayBillPage.module.css"


const EwayBillPage=()=>{


    const[data,setData]=useState({
        "TAX_ID":"",
        "DOC_NO":"",
        "CUSTOMER_ID":"",
        "DATE":"",
        "IRN":"",
        "ACK_NO":"",
        "ACK_DATE":"",
        "EWAYBILLNO":"",
        "GENERATD_BY":"",
        "SUPPLYTYPE":"",
        "GENERATED_DATE_TIME":"",
        "VALID_UPTO":"",
        "FROM":"",
        "TO":"",
        "DIPATCH_FROM":"",
        "SHIP_TO":"",
        "HSN_CODE":"",
        "PRODUCTNAME_DESC":"",
        "QUANTITY":"",
        "TAXABLEAMT":"",
        "TAX_RATE_CS":"",
        "TOTAL_TAX_AMOUNT":"",
        "TOTAL_INV_AMT":"",
        "TRANSPORTER_ID":"",
        "NAME":"",
        "VEHICLE_NUMBER":"",
        "PINCODE":"",
        "CEWB":""
    })

}

export default EwayBillPage;