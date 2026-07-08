import API from "./api";


const taxInvoice={
    regInvoice:async(payload)=>{
        try{
            
            const response= await API.post("/tax/invoice/add",payload)
            return response.data

        }
        catch(error)
        {
            console.error("Failed to add the tax invoice")
            throw error
        }
    },

    getAllInvoice:async()=>{
        try{
          
            const response = await API.get("/tax/invoice/all")
            return response.data

        }
        catch(error)
        {
         console.error("Failed to get the tax invoice")
         throw error   
        }
    },

    getAllInvoiceByCustomerId:async(CUSTOMER_ID)=>{
        try{
          
            const response = await API.get(`/tax/invoice/apply/filter?CUSTOMER_ID=${CUSTOMER_ID}`)
            return response.data

        }
        catch(error)
        {
         console.error("Failed to get the tax invoice by Invoice Number")
         throw error   
        }
    },

    getAllInvoiceByInvoiceNumber:async(INVOICE_NUMBER)=>{
        try{
           
            const response = await API.get(`/tax/invoice/apply/filter?INVOICE_NUMBER=${INVOICE_NUMBER}`)
            return response.data

        }
        catch(error)
        {
            console.error("Failed to get the tax invoice by Invoice Number")
            throw error
        }
    },

    getAllInvoiceEwayNo:async(EWAY_BILL_NO)=>{
        try{

            const response = await API.get(`/tax/invoice/apply/filter?EWAY_BILL_NO=${EWAY_BILL_NO}`)
            return response.data
        }

        catch(error)
        {
            console.error("Failed to get the tax invoice by Invoice Number")
            throw error
        }
    },

    updateInvoiceEwayNo:async(ID)=>{
        try{
          
            const response = await API.put(`/tax/invoice/update/${ID}`)
            return response.data

        }
        catch(error)
        {
             console.error("Failed to update the tax invoice")
             throw error
        }
    }
    


}


export default taxInvoice;