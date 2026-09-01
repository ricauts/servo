// The exact S3 IAM policy the Sources page renders (xds-09): scoped to
// the crawler's two read actions, nothing more. Lives beside the crawler
// so the text and the three commands it describes cannot drift apart,
// and so tests import a lib module rather than a page.

export const S3_LEAST_PRIVILEGE = `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::your-bucket", "arn:aws:s3:::your-bucket/your-prefix/*"]
    }
  ]
}`;
