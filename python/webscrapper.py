import argparse
from selenium import webdriver 
from selenium.webdriver.chrome.service import Service as ChromeService 
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.common.by import By
from selenium.webdriver.support.wait import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from bs4 import BeautifulSoup
import time
 
def getPage(url):
    options = webdriver.ChromeOptions() #newly added 
    options.add_argument('--headless') 
    with webdriver.Chrome(service=ChromeService(ChromeDriverManager().install()), options=options) as driver:
        driver.get(url)
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.CLASS_NAME, "xwd__layout--cluelists"))
        ) # wait for clue lists to load

        clue_lists = driver.find_elements(By.CLASS_NAME, "xwd__clue-list--wrapper")

        down = {}
        across = {}
        for clue_list in clue_lists:
            target = None
            title = clue_list.find_element(By.CLASS_NAME, "xwd__clue-list--title")

            if(title.text.lower() == 'across'):
                target = across
            elif(title.text.lower() == 'down'):
                target = down
            
            if(target == None):
                print("ERROR FINDING CLUE LIST")
                return
            
            



if __name__ == "__main__":
    parser = argparse.ArgumentParser(
                    prog='CrosswordWebscrapper',
                    description='Scrapes the crossword off a crossword link')
    parser.add_argument('source')
    parser.add_argument('url')
    args = parser.parse_args()
    getPage(args.url)