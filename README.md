You can stream logs from the command line by running:
  $ gcloud app logs tail -s default

To view your application in the web browser run:
  $ gcloud app browse

To run locally:
  $ npm run dev

Game states:
  Joining
          Prompts
          Answers
  Round:  Voting
          Results
          Scores
  Game Over

Client -> Server interactions:
  Register
  Login
  Submit Prompt
  Submit Answer
  Submit Vote
  (Admin) Next

Chosen Extension: Add a 4th round with a twist (when answering a prompt, the prompt words are in a random order)