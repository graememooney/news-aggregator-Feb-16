from fastapi import FastAPI

app = FastAPI(title="News Aggregator API")

@app.get("/")
def read_root():
    return {"message": "News Aggregator API is running"}
