import API from "./api";


const ewayBill={
    regEwayBill:async(payload)=>{
        try{
              const response = await API.post("/eway/bill/add",payload)
              return response.data
        }

        catch(error)
        {
            console.error("Failed to add the eway bill")
            throw error
        }
    },

    getAllEwayBill:async()=>{
        try{
            
            const resposne = await API.get("/eway/bill/all")
            return resposne.data
        }
        catch(error)
        {
            console.error("Failed to fetch the data of eway bill")
            throw error
        }
    },

    getByCustomerNoEwayBill:async(CUSTOMER_ID)=>{
        try{
            const response = await API.get(`/eway/bill/apply/filter?CUSTOMER_ID=${CUSTOMER_ID}`)
            return response.data
        }

        catch(error)
        {
          
            console.error("Failed to fetch the data of eway bill")
            throw error

        }
    },

    getByDocNoEwayBill:async(DOC_NO)=>{
        try{
            const response = await API.get(`/eway/bill/apply/filter?DOC_NO=${DOC_NO}`)
            return response.data
        }

        catch(error)
        {
          
            console.error("Failed to fetch the data of eway bill")
            throw error

        }
    },

    getByBillNoEwayBill:async(EWAYBILLNO)=>{
        try{
            const response = await API.get(`/eway/bill/apply/filter?EWAYBILLNO=${EWAYBILLNO}`)
            return response.data
        }

        catch(error)
        {
          
            console.error("Failed to fetch the data of eway bill")
            throw error

        }
    },

    updateEwayBill:async(ID)=>{
        try{
            const response = await API.put(`/eway/bill/update/${ID}`)
            return response.data
        }

        catch(error)
        { 
           console.error("Failed to get update the eway bill")
           throw error
        }
    },

    deleteEwayBill:async(ID)=>{
        try{
            const response = await API.delete(`/eway/bill/delete/${ID}`)
            return response.data
        }
        catch(error)
        {
            console.error("failed to delete the eway bill")
            throw error
        }
    }
}

export default ewayBill;