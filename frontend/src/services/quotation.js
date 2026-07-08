import API from "./api";


const quotation={

    regQuotation:async(payload)=>{

        try{
            const response = API.post("/quotations",payload)
            return response.data
        }

        catch(error)
        {
            console.error("Failed to register quotation")
            throw error
        }

    },

    getQuotation:async()=>{
        try{

        }
        catch(error)
        {

        }
    }
}